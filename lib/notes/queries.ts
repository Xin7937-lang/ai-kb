// Notes & tags data access — the public surface for S4-S8.
//
// All read/write paths that touch `notes`, `notes_fts`, `tags`, or `note_tags`
// go through this module. Higher-level workstreams (S5 image upload, S6
// import/export, S8 summarize) import the typed functions here instead of
// hand-rolling SQL.
//
// Conventions:
// - `*Summary` shapes are safe for list endpoints: no `content_json` (heavy).
// - `NoteFull` includes content for detail endpoints.
// - All ids are nanoid(12). All timestamps are Unix ms.
// - Tag names are always lowercased + trimmed before touching the DB.

import type { JSONContent } from '@tiptap/react';
import { nanoid } from 'nanoid';
import { getDb, tx } from '@/lib/db/client';
import { extractText } from './text-extract';
import { EMPTY_TIPTAP_DOC } from './tiptap-init';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NoteSummary = {
  id: string;
  title: string;
  /** Truncated content_text (~160 chars). Used as the fallback preview
   *  when the note has no AI-generated summary. */
  preview: string;
  /** AI-generated summary, or null. When set, the list UI prefers this
   *  over `preview` so the user sees a curated 3-line teaser. */
  summary: string | null;
  tags: string[];
  summaryState: 'none' | 'fresh' | 'stale' | 'generating';
  updatedAt: number;
  createdAt: number;
};

export type NoteFull = NoteSummary & {
  contentJson: JSONContent;
  contentText: string;
  summary: string | null;
};

export type Tag = {
  id: number;
  name: string;
  count: number;
  /** Parent tag id for two-level hierarchy. null = top-level. */
  parentId: number | null;
};

export type ListNotesParams = {
  q?: string;
  tagId?: number;
  limit?: number;
  offset?: number;
};

export type ListNotesResult = {
  data: NoteSummary[];
  total: number;
};

// ---------------------------------------------------------------------------
// Row shapes (what better-sqlite3 hands back, snake_case from SQL)
// ---------------------------------------------------------------------------

type NoteRow = {
  id: string;
  title: string;
  content_json: string;
  content_text: string;
  summary: string | null;
  summary_state: 'none' | 'fresh' | 'stale' | 'generating';
  created_at: number;
  updated_at: number;
};

type ListRow = NoteRow & { tags: string | null };

type TagRow = {
  id: number;
  name: string;
  count: number;
  parent_id: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function previewFromText(text: string, max = 160): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max).trimEnd() + '…';
}

function rowToSummary(row: ListRow): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    preview: previewFromText(row.content_text),
    summary: row.summary,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    summaryState: row.summary_state,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function rowToFull(row: NoteRow, tags: string[]): NoteFull {
  return {
    id: row.id,
    title: row.title,
    preview: previewFromText(row.content_text),
    tags,
    summaryState: row.summary_state,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    contentJson: parseContentJson(row.content_json),
    contentText: row.content_text,
    summary: row.summary,
  };
}

function parseContentJson(raw: string): JSONContent {
  try {
    const parsed = JSON.parse(raw) as JSONContent;
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return parsed;
    }
  } catch {
    // fall through
  }
  return EMPTY_TIPTAP_DOC;
}

/**
 * Build an FTS5 MATCH expression from user input. We wrap the term in double
 * quotes and double-up any embedded quotes — this lets the user search for
 * arbitrary phrases including FTS5-reserved characters without breaking the
 * query. Empty input returns an empty string (caller should skip FTS path).
 */
export function buildFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const escaped = trimmed.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Build a LIKE pattern from user input. Used as a FALLBACK when FTS5
 * returns zero matches — even with the `trigram` tokenizer, very short
 * queries (< 3 chars) or edge cases may still return no rows. LIKE
 * handles arbitrary substrings without that constraint.
 *
 * LIKE is slower (full table scan on content_text) so we only invoke it
 * when the FTS5 path produces zero rows.
 *
 * Escapes `%`, `_`, and `\` from user input so a literal `%` typed by
 * the user doesn't behave as a wildcard. The caller must also use
 * `ESCAPE '\\'` in the SQL.
 */
export function buildLikePattern(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const escaped = trimmed.replace(/[\\%_]/g, '\\$&');
  return `%${escaped}%`;
}

/**
 * Build an FTS5 OR-of-phrases expression from a list of search terms.
 * Each term is wrapped in double quotes (FTS5 phrase syntax) so a
 * single reserved char doesn't break the query, and the terms are
 * joined with `OR` so docs matching ANY term qualify.
 *
 * For CJK tokens longer than 3 characters, we split into overlapping
 * 3-character trigrams and OR them. This maximises recall with the
 * trigram tokenizer: a 4-character token like "数据库设计" becomes
 * "数据库" OR "据库设" OR "库设计", matching any note that contains
 * any of those substrings.
 *
 * Used by the chat retrieval to handle natural-language questions like
 * "有哪些 hermes 相关的内容": a plain phrase search would never match
 * (the phrase doesn't appear verbatim in any doc), but an OR of the
 * meaningful tokens ("hermes" OR "相关") finds docs containing either.
 */
export function buildFtsOrQuery(terms: string[]): string {
  const cleaned = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) return '';

  const isCjk = (s: string) => [...s].every((c) => c.charCodeAt(0) > 127);
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;

  const clauses: string[] = [];
  for (const t of cleaned) {
    if (t.length > 3 && isCjk(t)) {
      // Split CJK token into overlapping trigrams.
      const chars = [...t];
      for (let i = 0; i <= chars.length - 3; i++) {
        clauses.push(escape(chars.slice(i, i + 3).join('')));
      }
    } else {
      clauses.push(escape(t));
    }
  }

  return clauses.join(' OR ');
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List notes with optional full-text search and tag filter. Returns a page
 * of summaries plus the total count for the same filter (used by the UI
 * to render pagination).
 */
export function listNotes(params: ListNotesParams = {}): ListNotesResult {
  const { q, tagId, limit = 50, offset = 0 } = params;
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));

  const db = getDb();
  const ftsQuery = buildFtsQuery(q ?? '');

  // Three branches: FTS + tag, FTS only, tag only, neither. We build the SQL
  // explicitly so the prepared-statement cache stays hot for repeated calls.
  if (ftsQuery && tagId != null) {
    if (tagId === UNTAGGED_FILTER_ID) {
      const total = (
        db
          .prepare<[string], { c: number }>(
            `SELECT COUNT(*) AS c
               FROM notes n
               INNER JOIN notes_fts f ON f.rowid = n.rowid
              WHERE notes_fts MATCH ?
                AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id)`,
          )
          .get(ftsQuery) ?? { c: 0 }
      ).c;

      const rows = db
        .prepare<[string, number, number], ListRow>(
          `SELECT n.*, NULL AS tags
             FROM notes n
             INNER JOIN notes_fts f ON f.rowid = n.rowid
            WHERE notes_fts MATCH ?
              AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id)
            ORDER BY f.rank
            LIMIT ? OFFSET ?`,
        )
        .all(ftsQuery, safeLimit, safeOffset);

      return { data: rows.map(rowToSummary), total };
    }

    const total = (
      db
        .prepare<[string, number], { c: number }>(
          `SELECT COUNT(DISTINCT n.rowid) AS c
             FROM notes n
             INNER JOIN notes_fts f ON f.rowid = n.rowid
             INNER JOIN note_tags nt ON nt.note_id = n.id
            WHERE notes_fts MATCH ? AND nt.tag_id = ?`,
        )
        .get(ftsQuery, tagId) ?? { c: 0 }
    ).c;

    if (total === 0) {
      // FTS5 missed -- likely a CJK substring query. Fall back to LIKE on
      // (content_text OR title) AND tagId. Catches the common case of
      // typing a Chinese substring that's inside a longer CJK token.
      return runLikeListQuery(db, q ?? '', tagId, safeLimit, safeOffset);
    }

    const rows = db
      .prepare<[string, number, number, number], ListRow>(
        `SELECT n.*,
                (SELECT GROUP_CONCAT(t.name, ',')
                   FROM note_tags nt
                   INNER JOIN tags t ON t.id = nt.tag_id
                  WHERE nt.note_id = n.id) AS tags
           FROM notes n
           INNER JOIN notes_fts f ON f.rowid = n.rowid
           INNER JOIN note_tags nt2 ON nt2.note_id = n.id
          WHERE notes_fts MATCH ? AND nt2.tag_id = ?
          ORDER BY f.rank
          LIMIT ? OFFSET ?`,
      )
      .all(ftsQuery, tagId, safeLimit, safeOffset);

    return { data: rows.map(rowToSummary), total };
  }

  if (ftsQuery) {
    const total = (
      db
        .prepare<[string], { c: number }>(
          `SELECT COUNT(*) AS c
             FROM notes n
             INNER JOIN notes_fts f ON f.rowid = n.rowid
            WHERE notes_fts MATCH ?`,
        )
        .get(ftsQuery) ?? { c: 0 }
    ).c;

    if (total === 0) {
      // FTS5 missed -- likely a CJK substring query. Fall back to LIKE on
      // content_text OR title. See buildLikePattern for the escape rules.
      return runLikeListQuery(db, q ?? '', null, safeLimit, safeOffset);
    }

    const rows = db
      .prepare<[string, number, number], ListRow>(
        `SELECT n.*,
                (SELECT GROUP_CONCAT(t.name, ',')
                   FROM note_tags nt
                   INNER JOIN tags t ON t.id = nt.tag_id
                  WHERE nt.note_id = n.id) AS tags
           FROM notes n
           INNER JOIN notes_fts f ON f.rowid = n.rowid
          WHERE notes_fts MATCH ?
          ORDER BY f.rank
          LIMIT ? OFFSET ?`,
      )
      .all(ftsQuery, safeLimit, safeOffset);

    return { data: rows.map(rowToSummary), total };
  }

  if (tagId != null) {
    if (tagId === UNTAGGED_FILTER_ID) {
      const total = (
        db
          .prepare<[], { c: number }>(
            `SELECT COUNT(*) AS c
               FROM notes n
              WHERE NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id)`,
          )
          .get() ?? { c: 0 }
      ).c;

      const rows = db
        .prepare<[number, number], ListRow>(
          `SELECT n.*, NULL AS tags
             FROM notes n
            WHERE NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id)
            ORDER BY n.updated_at DESC
            LIMIT ? OFFSET ?`,
        )
        .all(safeLimit, safeOffset);

      return { data: rows.map(rowToSummary), total };
    }

    const total = (
      db
        .prepare<[number], { c: number }>(
          `SELECT COUNT(DISTINCT n.id) AS c
             FROM notes n
             INNER JOIN note_tags nt ON nt.note_id = n.id
            WHERE nt.tag_id = ?`,
        )
        .get(tagId) ?? { c: 0 }
    ).c;

    const rows = db
      .prepare<[number, number, number], ListRow>(
        `SELECT n.*,
                (SELECT GROUP_CONCAT(t.name, ',')
                   FROM note_tags nt
                   INNER JOIN tags t ON t.id = nt.tag_id
                  WHERE nt.note_id = n.id) AS tags
           FROM notes n
           INNER JOIN note_tags nt2 ON nt2.note_id = n.id
          WHERE nt2.tag_id = ?
          ORDER BY n.updated_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(tagId, safeLimit, safeOffset);

    return { data: rows.map(rowToSummary), total };
  }

  const total = (
    db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM notes').get() ?? {
      c: 0,
    }
  ).c;

  const rows = db
    .prepare<[number, number], ListRow>(
      `SELECT n.*,
              (SELECT GROUP_CONCAT(t.name, ',')
                 FROM note_tags nt
                 INNER JOIN tags t ON t.id = nt.tag_id
                WHERE nt.note_id = n.id) AS tags
         FROM notes n
         ORDER BY n.updated_at DESC
         LIMIT ? OFFSET ?`,
    )
    .all(safeLimit, safeOffset);

  return { data: rows.map(rowToSummary), total };
}

/**
 * LIKE-based fallback for `listNotes`. Used when FTS5 returns zero rows
 * for a query -- most commonly because the user typed a query shorter
 * than 3 characters (trigram needs at least 3 chars to match). LIKE
 * handles arbitrary substrings without that constraint.
 *
 * `tagId` is optional; when null, no tag filter is applied.
 */
function runLikeListQuery(
  db: ReturnType<typeof getDb>,
  q: string,
  tagId: number | null,
  safeLimit: number,
  safeOffset: number,
): ListNotesResult {
  const like = buildLikePattern(q);
  if (!like) {
    return { data: [], total: 0 };
  }
  if (tagId != null) {
    const total = (
      db
        .prepare<[string, string, number], { c: number }>(
          `SELECT COUNT(DISTINCT n.id) AS c
             FROM notes n
             INNER JOIN note_tags nt ON nt.note_id = n.id
            WHERE (n.content_text LIKE ? ESCAPE '\\' OR n.title LIKE ? ESCAPE '\\')
              AND nt.tag_id = ?`,
        )
        .get(like, like, tagId) ?? { c: 0 }
    ).c;
    const rows = db
      .prepare<[string, string, number, number, number], ListRow>(
        `SELECT n.*,
                (SELECT GROUP_CONCAT(t.name, ',')
                   FROM note_tags nt
                   INNER JOIN tags t ON t.id = nt.tag_id
                  WHERE nt.note_id = n.id) AS tags
           FROM notes n
           INNER JOIN note_tags nt ON nt.note_id = n.id
          WHERE (n.content_text LIKE ? ESCAPE '\\' OR n.title LIKE ? ESCAPE '\\')
            AND nt.tag_id = ?
          ORDER BY n.updated_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(like, like, tagId, safeLimit, safeOffset);
    return { data: rows.map(rowToSummary), total };
  }
  const total = (
    db
      .prepare<[string, string], { c: number }>(
        `SELECT COUNT(*) AS c
           FROM notes
          WHERE content_text LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'`,
      )
      .get(like, like) ?? { c: 0 }
  ).c;
  const rows = db
    .prepare<[string, string, number, number], ListRow>(
      `SELECT n.*,
              (SELECT GROUP_CONCAT(t.name, ',')
                 FROM note_tags nt
                 INNER JOIN tags t ON t.id = nt.tag_id
                WHERE nt.note_id = n.id) AS tags
         FROM notes n
        WHERE n.content_text LIKE ? ESCAPE '\\' OR n.title LIKE ? ESCAPE '\\'
        ORDER BY n.updated_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(like, like, safeLimit, safeOffset);
  return { data: rows.map(rowToSummary), total };
}

/**
 * Get a single note by id, including its full content and tag list. Returns
 * null if the note doesn't exist.
 */
export function getNote(id: string): NoteFull | null {
  const db = getDb();
  const row = db
    .prepare<[string], NoteRow>(
      'SELECT * FROM notes WHERE id = ?',
    )
    .get(id);
  if (!row) return null;

  const tagRows = db
    .prepare<[string], { name: string }>(
      `SELECT t.name
         FROM tags t
         INNER JOIN note_tags nt ON nt.tag_id = t.id
        WHERE nt.note_id = ?
        ORDER BY t.name`,
    )
    .all(id);
  return rowToFull(row, tagRows.map((r) => r.name));
}

export type BatchUpdateNoteTagsInput = {
  noteIds: string[];
  addTags: string[];
  removeTags: string[];
};

/**
 * Batch-update tags on multiple notes. For each note, `removeTags` are
 * removed first, then `addTags` are appended. The resulting tag list is
 * normalized (lowercased, trimmed, deduped) via setNoteTags, same as
 * single-note editing. ALL operations are wrapped in a single transaction
 * so partial failures roll back the entire batch.
 *
 * Embeddings are NOT regenerated — the chunk contents didn't change, only
 * the tag metadata.
 */
export function batchUpdateNoteTags(input: BatchUpdateNoteTagsInput): { updated: number } {
  const { noteIds, addTags, removeTags } = input;
  if (noteIds.length === 0) return { updated: 0 };

  const removeSet = new Set(normalizeTagNames(removeTags));

  tx((db) => {
    const getTagNames = db.prepare<[string], { name: string }>(
      `SELECT t.name
         FROM tags t
         INNER JOIN note_tags nt ON nt.tag_id = t.id
        WHERE nt.note_id = ?
        ORDER BY t.name`,
    );

    for (const noteId of noteIds) {
      const existing = getTagNames.all(noteId).map((r) => r.name);
      // Remove requested tags, then add requested tags.
      const merged = [
        ...existing.filter((t) => !removeSet.has(t)),
        ...addTags,
      ];
      // setNoteTags handles normalization, dedupe, and the actual DB writes.
      setNoteTags(noteId, merged);
    }
  });

  return { updated: noteIds.length };
}

export type CreateNoteInput = {
  title: string;
  contentJson: JSONContent;
  contentText?: string;
  tags?: string[];
};

/**
 * Create a new note. The provided `contentJson` is what we store verbatim —
 * if `contentText` is omitted, we extract it server-side from the JSON.
 * The summary_state defaults to 'none' (no AI summary yet). Tag names are
 * normalized, deduped, and inserted via {@link setNoteTags}.
 *
 * Returns the created note plus an `embedded` flag indicating whether
 * chunks were successfully embedded into sqlite-vec. Callers that don't
 * care about embedding status can ignore the flag (it just spreads onto
 * the existing NoteFull shape). This is used by the agent create_note
 * tool (ticket 01) to record the right audit result.
 */
export type CreateNoteResult = NoteFull & { embedded: boolean };

export async function createNote(
  input: CreateNoteInput,
): Promise<CreateNoteResult> {
  const title = input.title.trim() || '未命名笔记';
  const contentJson = input.contentJson ?? EMPTY_TIPTAP_DOC;
  const contentText = (
    input.contentText ?? extractText(contentJson)
  ).trim();
  const id = nanoid(12);
  const now = Date.now();

  tx((db) => {
    db.prepare(
      `INSERT INTO notes
         (id, title, content_json, content_text, summary, summary_state,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run(id, title, JSON.stringify(contentJson), contentText, now, now);

    setNoteTags(id, input.tags ?? []);
  });

  // Generate chunks + (best-effort) embeddings OUTSIDE the transaction.
  // The note is already saved; embedding failure is logged but not thrown.
  const chunks = await replaceNoteChunks(id, contentText);
  if (chunks.error) {
    console.error(
      `[notes.createNote] embedding failed for ${id}: ${chunks.error}`,
    );
  }

  const created = getNote(id);
  if (!created) {
    throw new Error('createNote: note disappeared after insert');
  }
  return { ...created, embedded: chunks.embedded };
}

export type UpdateNoteInput = {
  title: string;
  contentJson: JSONContent;
  contentText?: string;
  tags?: string[];
  /**
   * If true, also clear the existing `summary` column (used when content
   * changes and the old summary is no longer relevant). When omitted, the
   * summary is left in place but `summary_state` is set to 'stale' so S8
   * knows to regenerate.
   */
  clearSummary?: boolean;
};

/**
 * Update an existing note. Returns the new full note, or null if the id
 * doesn't exist. If the title or content changed, `updated_at` and
 * `summary_state` are refreshed; FTS is kept in sync by the existing
 * triggers so we don't have to touch `notes_fts` directly.
 */
export async function updateNote(
  id: string,
  input: UpdateNoteInput,
): Promise<NoteFull | null> {
  const db = getDb();
  const existing = db
    .prepare<[string], NoteRow>('SELECT * FROM notes WHERE id = ?')
    .get(id);
  if (!existing) return null;

  const title = input.title.trim() || '未命名笔记';
  const contentJson = input.contentJson ?? EMPTY_TIPTAP_DOC;
  const newText = (input.contentText ?? extractText(contentJson)).trim();
  const now = Date.now();

  const contentChanged =
    existing.title !== title ||
    existing.content_json !== JSON.stringify(contentJson) ||
    existing.content_text !== newText;

  const nextSummaryState = contentChanged ? 'stale' : existing.summary_state;
  const nextSummary = contentChanged && input.clearSummary ? null : existing.summary;

  tx((db2) => {
    db2
      .prepare(
        `UPDATE notes
            SET title = ?,
                content_json = ?,
                content_text = ?,
                summary = ?,
                summary_state = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        title,
        JSON.stringify(contentJson),
        newText,
        nextSummary,
        nextSummaryState,
        now,
        id,
      );

    if (input.tags !== undefined) {
      setNoteTags(id, input.tags);
    }
  });

  // Regenerate chunks when content actually changed.
  if (contentChanged) {
    const result = await replaceNoteChunks(id, newText);
    if (result.error) {
      console.error(
        `[notes.updateNote] embedding failed for ${id}: ${result.error}`,
      );
    }
  }

  return getNote(id);
}

/**
 * Delete a note. Foreign-key cascades on `note_tags` and `assets`
 * (SET NULL on assets) are handled by the schema. Chunk + vec rows
 * are removed explicitly via `clearNoteChunks` because vec0 does not
 * honor FK CASCADE.
 */
export function deleteNote(id: string): boolean {
  clearNoteChunks(id);
  const result = getDb()
    .prepare('DELETE FROM notes WHERE id = ?')
    .run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Chunk + embedding write path
// ---------------------------------------------------------------------------

import { chunkNote, type Chunk } from './chunk';
import {
  detectEmbeddingEnabled,
  embedTexts,
  isEmbeddingEnabled,
  EMBEDDING_DIMENSION,
} from '@/lib/ai/embeddings';

/**
 * Delete all chunks and vec rows for a note. Run before inserting the
 * new chunk set so the function is safe to call on update.
 *
 * Note: the FK CASCADE on `note_chunks.note_id` would clean the rows
 * on note delete, but the vec rows for those chunks are NOT cascade-
 * deleted (vec0 does not honor FK semantics). We have to clean those
 * explicitly — but only if the vec virtual table actually exists.
 * The v3 migration is best-effort about creating it (vec0 needs the
 * sqlite-vec extension), so on dev machines where the extension isn't
 * installed, the table is absent and the DELETE would throw.
 */
export function clearNoteChunks(noteId: string): void {
  const db = getDb();
  const ids = db
    .prepare<[string], { id: number }>(
      'SELECT id FROM note_chunks WHERE note_id = ?',
    )
    .all(noteId);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const vecExists = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE name = 'note_chunks_vec'",
    )
    .get();
  // `db.exec` does not bind parameters — use prepare + run so the
  // placeholders actually receive the chunk ids.
  if (vecExists) {
    // sqlite-vec 0.1.x rejects JS numbers as the chunk_id primary key
    // (it only accepts BigInt). Convert before binding.
    db
      .prepare<unknown[], unknown>(
        `DELETE FROM note_chunks_vec WHERE chunk_id IN (${placeholders})`,
      )
      .run(...ids.map((r) => BigInt(r.id)));
  }
  db
    .prepare<unknown[], unknown>(
      `DELETE FROM note_chunks WHERE id IN (${placeholders})`,
    )
    .run(...ids.map((r) => r.id));
}

export type ReplaceChunksResult = {
  inserted: number;
  embedded: boolean;
  error: string | null;
};

/**
 * Compute chunks for `content`, write them, and (best-effort) embed
 * each one into `note_chunks_vec`. Embedding failures are NOT fatal —
 * the chunks are still written so FTS5 can find them. The `error`
 * field surfaces the failure to the caller for logging / UI.
 */
export async function replaceNoteChunks(
  noteId: string,
  content: string,
): Promise<ReplaceChunksResult> {
  const chunks: Chunk[] = chunkNote(content);
  if (chunks.length === 0) {
    return { inserted: 0, embedded: false, error: null };
  }

  // 1. Wipe previous chunks + vec rows for this note.
  clearNoteChunks(noteId);

  // 2. Insert chunk rows in one transaction.
  const db = getDb();
  const insertChunk = db.prepare(
    `INSERT INTO note_chunks
       (note_id, chunk_index, content, start_pos, end_pos, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const insertedIds: number[] = [];
  db.transaction(() => {
    for (const c of chunks) {
      const info = insertChunk.run(
        noteId,
        c.chunkIndex,
        c.content,
        c.startPos,
        c.endPos,
        now,
      );
      insertedIds.push(Number(info.lastInsertRowid));
    }
  })();

  // 3. Best-effort embedding.
  if (!isEmbeddingEnabled()) {
    // Try to load on first use.
    detectEmbeddingEnabled();
  }
  if (!isEmbeddingEnabled()) {
    return { inserted: insertedIds.length, embedded: false, error: null };
  }
  try {
    const vectors = await embedTexts(chunks.map((c) => c.content));
    const insertVec = db.prepare(
      `INSERT INTO note_chunks_vec (chunk_id, embedding) VALUES (?, ?)`,
    );
    db.transaction(() => {
      for (let i = 0; i < insertedIds.length; i++) {
        // sqlite-vec 0.1.x requires BigInt for the chunk_id primary key.
        insertVec.run(BigInt(insertedIds[i]), vecToBuffer(vectors[i]));
      }
    })();
    return { inserted: insertedIds.length, embedded: true, error: null };
  } catch (err) {
    return {
      inserted: insertedIds.length,
      embedded: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Serialize a 1024-dim float32 array into a Buffer for sqlite-vec.
 * vec0 expects a raw little-endian float32 buffer of length 4 * dim.
 */
function vecToBuffer(vec: number[]): Buffer {
  if (vec.length !== EMBEDDING_DIMENSION) {
    throw new Error(`vec dim mismatch: ${vec.length}`);
  }
  const buf = Buffer.alloc(4 * vec.length);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

/**
 * Normalize raw tag strings from the user: trim, lowercase, drop empties,
 * dedupe (preserving first-seen order). Pure function — exported so callers
 * (e.g. the edit form) can preview the normalized list before saving.
 */
export function normalizeTagNames(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const original of raw) {
    if (typeof original !== 'string') continue;
    const t = original.trim().toLowerCase();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Replace the tag set for a note. Tag names are normalized first; missing
 * tags are inserted on demand. Does NOT delete tag rows that no note uses
 * any more — that's an explicit user action via `PUT /api/tags`.
 */
export function setNoteTags(noteId: string, rawTagNames: string[]): void {
  const names = normalizeTagNames(rawTagNames);
  if (names.length === 0) {
    getDb().prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
    return;
  }

  tx((db) => {
    const upsert = db.prepare(
      'INSERT INTO tags (name) VALUES (?) ' +
        'ON CONFLICT(name) DO NOTHING',
    );
    for (const name of names) {
      upsert.run(name);
    }

    const lookup = db.prepare<[string], { id: number }>(
      'SELECT id FROM tags WHERE name = ?',
    );
    const tagIds = names.map((n) => {
      const row = lookup.get(n);
      if (!row) {
        throw new Error(`setNoteTags: tag "${n}" missing after upsert`);
      }
      return row.id;
    });

    db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
    const link = db.prepare(
      'INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)',
    );
    for (const tagId of tagIds) {
      link.run(noteId, tagId);
    }
  });
}

/**
 * List all tags, sorted by usage count desc then name asc. Tags with zero
 * notes are included so the UI can show "unused" tags and let the user
 * clean them up via `PUT /api/tags`.
 */
export function listTagsWithCount(): Tag[] {
  const rows = getDb()
    .prepare<[], TagRow>(
      `SELECT t.id, t.name, t.parent_id,
              (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS count
         FROM tags t
         ORDER BY t.position ASC, t.name ASC`,
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    count: r.count,
    parentId: r.parent_id,
  }));
}

export type TagRename = { from: string; to: string };

/**
 * Batch rename / merge tags. A rename where `to` is empty string deletes
 * the tag; otherwise the `from` tag is renamed to `to` (which may already
 * exist, in which case the tags are merged: the `from` row is dropped and
 * its `note_tags` rows point to the surviving `to` tag).
 *
 * Returns the refreshed tag list.
 */
export function renameTags(renames: TagRename[]): Tag[] {
  if (renames.length === 0) return listTagsWithCount();

  tx((db) => {
    const getByName = db.prepare<[string], { id: number }>(
      'SELECT id FROM tags WHERE name = ?',
    );
    const updateName = db.prepare(
      'UPDATE tags SET name = ? WHERE id = ?',
    );
    const deleteTag = db.prepare('DELETE FROM tags WHERE id = ?');

    for (const r of renames) {
      const fromName = r.from.trim().toLowerCase();
      const toName = r.to.trim().toLowerCase();
      if (!fromName) continue;
      if (fromName === toName) continue;

      const fromRow = getByName.get(fromName);
      if (!fromRow) continue;

      if (!toName) {
        // Empty `to` means "delete this tag". Cascading FK on note_tags
        // does the cleanup.
        deleteTag.run(fromRow.id);
        continue;
      }

      const toRow = getByName.get(toName);
      if (!toRow) {
        // Simple rename: no collision.
        updateName.run(toName, fromRow.id);
        continue;
      }

      // Collision: merge `from` into `to`. We move all note_tags rows, then
      // delete the now-empty `from` row. UNIQUE(name) means we have to
      // rename `from` temporarily first so the INSERT/UPDATE on the same
      // table doesn't trip.
      if (fromRow.id === toRow.id) continue;
      const tempName = `__merge_${fromRow.id}_${Date.now()}__`;
      updateName.run(tempName, fromRow.id);
      db.prepare(
        'UPDATE note_tags SET tag_id = ? WHERE tag_id = ?',
      ).run(toRow.id, fromRow.id);
      deleteTag.run(fromRow.id);
    }
  });

  return listTagsWithCount();
}

// ---------------------------------------------------------------------------
// Manual tag ordering + built-in 收藏 (favorites) tag
// ---------------------------------------------------------------------------

// Re-exported here so existing server-side imports of
// `FAVORITES_TAG_NAME` from `@/lib/notes/queries` keep working without
// touching the API. The string itself lives in `constants.ts` so client
// components can import it without dragging better-sqlite3 into their
// bundle.
import {
  FAVORITES_TAG_NAME as FAVORITES_TAG_NAME_CONST,
  UNTAGGED_FILTER_ID,
} from './constants';
export const FAVORITES_TAG_NAME = FAVORITES_TAG_NAME_CONST;

/**
 * Idempotently ensure the 收藏 tag exists and return its id.
 * Position 5 keeps it after the 5 default knowledge-management tags.
 */
export function ensureFavoritesTag(): number {
  const db = getDb();
  const row = db
    .prepare<[string], { id: number }>(
      'SELECT id FROM tags WHERE name = ?',
    )
    .get(FAVORITES_TAG_NAME);
  if (row) return row.id;
  tx((txDb) => {
    txDb
      .prepare(
        'INSERT INTO tags (name, position, parent_id) VALUES (?, 5, NULL)',
      )
      .run(FAVORITES_TAG_NAME);
  });
  const created = db
    .prepare<[string], { id: number }>(
      'SELECT id FROM tags WHERE name = ?',
    )
    .get(FAVORITES_TAG_NAME);
  if (!created) {
    throw new Error('ensureFavoritesTag: insert succeeded but row missing');
  }
  return created.id;
}

/**
 * Create a new tag. `parentId` can be null (top-level) or point to
 * an existing tag (making this a child). Position defaults to the
 * end of the parent's sibling set so the new tag sorts last.
 */
export function createTag(name: string, parentId?: number | null): Tag {
  const db = getDb();
  const tagName = name.trim().toLowerCase();

  // Compute position: max position among siblings + 1, or 0 if none.
  const maxPos = parentId != null
    ? db
        .prepare<[number], { mp: number | null }>(
          'SELECT MAX(position) AS mp FROM tags WHERE parent_id = ?',
        )
        .get(parentId)?.mp
    : db
        .prepare<[], { mp: number | null }>(
          'SELECT MAX(position) AS mp FROM tags WHERE parent_id IS NULL',
        )
        .get()?.mp;
  const nextPos = (maxPos ?? -1) + 1;

  db.prepare(
    'INSERT INTO tags (name, position, parent_id) VALUES (?, ?, ?)',
  ).run(tagName, nextPos, parentId ?? null);

  const row = db
    .prepare<[string], TagRow>(
      `SELECT t.id, t.name, t.parent_id,
              (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS count
         FROM tags t WHERE t.name = ?`,
    )
    .get(tagName);
  if (!row) throw new Error('createTag: tag disappeared after insert');
  return { id: row.id, name: row.name, count: row.count, parentId: row.parent_id };
}

/**
 * List tags as a two-level tree. Top-level tags have their direct
 * children nested in the `children` array. Each node includes up to
 * `maxPerTag` recent notes.
 */
export function listTagTree(opts: { maxPerTag?: number } = {}): TagWithNotes[] {
  const maxPerTag = opts.maxPerTag ?? 3;
  const allTags = listTagsWithCount();

  // Single query: every note with its tags.
  const rows = getDb()
    .prepare<[], {
      tag_id: number;
      id: string;
      title: string;
      content_text: string;
      summary_state: 'none' | 'fresh' | 'stale' | 'generating';
      updated_at: number;
      created_at: number;
    }>(
      `SELECT nt.tag_id, n.id, n.title, n.content_text,
              n.summary_state, n.updated_at, n.created_at
         FROM notes n
         JOIN note_tags nt ON nt.note_id = n.id
        ORDER BY n.updated_at DESC`,
    )
    .all();

  const byTag = new Map<number, NoteSummary[]>();
  for (const r of rows) {
    const note: NoteSummary = {
      id: r.id,
      title: r.title,
      preview: r.content_text,
      summary: null,
      tags: [],
      summaryState: r.summary_state,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
    };
    let arr = byTag.get(r.tag_id);
    if (!arr) {
      arr = [];
      byTag.set(r.tag_id, arr);
    }
    if (arr.length < maxPerTag) {
      arr.push(note);
    }
  }

  // Build tree: partition into top-level and children.
  const topLevel = allTags.filter((t) => t.parentId == null);
  const children = allTags.filter((t) => t.parentId != null);

  return topLevel.map((t) => ({
    ...t,
    notes: byTag.get(t.id) ?? [],
    children: children
      .filter((c) => c.parentId === t.id)
      .map((c) => ({ ...c, notes: byTag.get(c.id) ?? [], children: [] })),
  }));
}

/**
 * Set tag positions to 0, 1, 2, ... in the order given. Tags not present
 * in `order` keep their current position (so a partial reorder is a
 * supported operation). Duplicate ids in `order` are deduped, last
 * occurrence wins.
 *
 * Designed for the "give me the new top-to-bottom list" UI semantics: the
 * client passes the full visible order and we just write it down.
 */
export function setTagsPositions(order: number[]): void {
  if (order.length === 0) return;
  const db = getDb();

  // Validate: every id must exist. We don't want a typo to silently
  // succeed and leave a phantom position written.
  const placeholders = order.map(() => '?').join(',');
  const existing = db
    .prepare<unknown[], { id: number }>(
      `SELECT id FROM tags WHERE id IN (${placeholders})`,
    )
    .all(...order);
  const validIds = new Set(existing.map((r) => r.id));
  for (const id of order) {
    if (!validIds.has(id)) {
      throw new Error(`setTagsPositions: unknown tag id ${id}`);
    }
  }

  tx((txDb) => {
    const update = txDb.prepare(
      'UPDATE tags SET position = ? WHERE id = ?',
    );
    // Dedup while preserving last occurrence's position.
    const seen = new Set<number>();
    const deduped: number[] = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      deduped.push(id);
    }
    for (let i = 0; i < deduped.length; i++) {
      update.run(i, deduped[i]);
    }
  });
}

/**
 * Batch-delete tags by id. Tags whose name is in the built-in set
 * (currently just 收藏) are silently skipped and returned in the
 * `skipped` array so the UI can surface a friendly message. The
 * `note_tags` join rows are cleaned up automatically via the
 * `ON DELETE CASCADE` on that table's foreign key.
 *
 * Returns:
 *   - `deletedIds`: ids that were actually removed
 *   - `skipped`: tag names that were left alone (e.g. 收藏)
 *   - `missing`: ids that didn't match any tag (caller can ignore or warn)
 */
export function deleteTagsByIds(ids: number[]): {
  deletedIds: number[];
  skipped: string[];
  missing: number[];
} {
  const result = { deletedIds: [] as number[], skipped: [] as string[], missing: [] as number[] };
  if (ids.length === 0) return result;
  const SKIP_NAMES = new Set<string>([FAVORITES_TAG_NAME]);

  tx((db) => {
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare<unknown[], { id: number; name: string }>(
        `SELECT id, name FROM tags WHERE id IN (${placeholders})`,
      )
      .all(...ids);

    const seen = new Set<number>();
    const toDelete: number[] = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (SKIP_NAMES.has(r.name)) {
        result.skipped.push(r.name);
      } else {
        toDelete.push(r.id);
      }
    }
    for (const id of ids) {
      if (!seen.has(id)) result.missing.push(id);
    }
    if (toDelete.length === 0) return;

    const delPlaceholders = toDelete.map(() => '?').join(',');
    db.prepare(`DELETE FROM tags WHERE id IN (${delPlaceholders})`).run(
      ...toDelete,
    );
    result.deletedIds = toDelete;
  });

  return result;
}

/**
 * Toggle the built-in 收藏 tag on a note. Returns the new favorited
 * state and the tag id (so the client can show the star without an
 * extra roundtrip). Throws 'note_not_found' if the note id is bogus.
 */
export function toggleNoteFavorite(
  noteId: string,
): { favorited: boolean; favoriteTagId: number } {
  const note = getNote(noteId);
  if (!note) {
    throw new Error('note_not_found');
  }
  const favoriteTagId = ensureFavoritesTag();
  const isFavorited = note.tags.includes(FAVORITES_TAG_NAME);
  const next = isFavorited
    ? note.tags.filter((t) => t !== FAVORITES_TAG_NAME)
    : [...note.tags, FAVORITES_TAG_NAME];
  setNoteTags(noteId, next);
  return { favorited: !isFavorited, favoriteTagId };
}

// ---------------------------------------------------------------------------
// FTS5 with column weighting (used by chat retrieval)
// ---------------------------------------------------------------------------

export type FtsSearchResult = {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  updatedAt: number;
  createdAt: number;
  /**
   * bm25() score from SQLite. Lower = more relevant (FTS5 ranks ascending).
   * Multiply by negative in the consumer to get a "higher = better" value.
   */
  bm25: number;
};

/**
 * FTS5 search with per-column weights via the bm25() auxiliary function.
 * We pass the user query through the same `buildFtsQuery` sanitizer
 * used by the rest of the app, but add a second branch that uses
 * bm25() so the title column dominates content (default weights:
 * 10.0 for column 0 = title, 1.0 for column 1 = content).
 */
export function searchNotesFts(
  query: string,
  opts: { 
    limit?: number; 
    titleWeight?: number; 
    contentWeight?: number;
    /**
     * If provided, used as the FTS5 MATCH expression instead of
     * `buildFtsQuery(query)`. The `query` parameter is still consulted
     * for the LIKE fallback path. Callers that need an OR-of-tokens
     * query (e.g. the chat retrieval) pre-build it via
     * `buildFtsOrQuery(terms)` and pass it here.
     */
    ftsQuery?: string;
  } = {},
): FtsSearchResult[] {
  const limit = opts.limit ?? 5;
  const titleWeight = opts.titleWeight ?? 10.0;
  const contentWeight = opts.contentWeight ?? 1.0;
  const effectiveFtsQuery = opts.ftsQuery ?? buildFtsQuery(query);
  const db = getDb();

  if (effectiveFtsQuery) {
    const rows = db
      .prepare<unknown[], {
        id: string;
        title: string;
        content_text: string;
        updated_at: number;
        created_at: number;
        summary_state: 'none' | 'fresh' | 'stale' | 'generating';
        bm25: number;
        tags: string;
      }>(
        `SELECT n.id, n.title, substr(n.content_text, 1, 240) AS content_text,
                n.updated_at, n.created_at, n.summary_state,
                bm25(notes_fts, ?, ?) AS bm25,
                (SELECT GROUP_CONCAT(t.name, '|') FROM note_tags nt
                   JOIN tags t ON t.id = nt.tag_id
                  WHERE nt.note_id = n.id) AS tags
           FROM notes n
           JOIN notes_fts f ON f.rowid = n.rowid
          WHERE notes_fts MATCH ?
          ORDER BY bm25
          LIMIT ?`,
      )
      .all(titleWeight, contentWeight, effectiveFtsQuery, limit);

    if (rows.length > 0) {
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        preview: r.content_text,
        tags: r.tags ? (r.tags as string).split('|').filter(Boolean) : [],
        updatedAt: r.updated_at,
        createdAt: r.created_at,
        bm25: r.bm25,
      }));
    }
    // FTS5 missed -- fall through to LIKE so CJK substring searches still
    // return context to the chat model instead of an empty sources array.
  }

  // LIKE fallback. We use a synthetic bm25 of 0.5 (mid-range) so the
  // caller-side multi-signal re-rank in lib/ai/retrieval.ts still orders
  // the results; the bm25 column isn't meaningful here, the row order is
  // simply "most recently updated first" (the LIKE query's natural order).
  const like = buildLikePattern(query);
  if (!like) return [];
  const rows = db
    .prepare<unknown[], {
      id: string;
      title: string;
      content_text: string;
      updated_at: number;
      created_at: number;
      summary_state: 'none' | 'fresh' | 'stale' | 'generating';
      tags: string;
    }>(
      `SELECT n.id, n.title, substr(n.content_text, 1, 240) AS content_text,
              n.updated_at, n.created_at, n.summary_state,
              (SELECT GROUP_CONCAT(t.name, '|') FROM note_tags nt
                 JOIN tags t ON t.id = nt.tag_id
                WHERE nt.note_id = n.id) AS tags
         FROM notes n
        WHERE n.content_text LIKE ? ESCAPE '\\' OR n.title LIKE ? ESCAPE '\\'
        ORDER BY n.updated_at DESC
        LIMIT ?`,
    )
    .all(like, like, limit);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    preview: r.content_text,
    tags: r.tags ? (r.tags as string).split('|').filter(Boolean) : [],
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    bm25: 0.5,
  }));
}

// ---------------------------------------------------------------------------
// Stats (home page banner)
// ---------------------------------------------------------------------------

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aggregate stats used by the home page welcome banner. Cheap to compute
 * (a few indexed COUNT() / MAX() queries); safe to call on every render.
 */
export type NoteStats = {
  total: number;
  /** Notes whose `created_at` falls within the last 7 days. */
  lastWeek: number;
  /** Notes whose `created_at` falls within the last 30 days. */
  lastMonth: number;
  /** Most recent `updated_at`, or null if no notes. */
  lastUpdatedAt: number | null;
  /** Top N tags by usage (handy for the banner's "trending tags" row). */
  topTags: Tag[];
};

export function getNoteStats(opts: { topTagLimit?: number } = {}): NoteStats {
  const topTagLimit = opts.topTagLimit ?? 5;
  const db = getDb();
  const now = Date.now();

  const total =
    db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM notes').get()?.c ?? 0;

  const lastWeek =
    db
      .prepare<[number], { c: number }>(
        'SELECT COUNT(*) AS c FROM notes WHERE created_at >= ?',
      )
      .get(now - 7 * ONE_DAY_MS)?.c ?? 0;

  const lastMonth =
    db
      .prepare<[number], { c: number }>(
        'SELECT COUNT(*) AS c FROM notes WHERE created_at >= ?',
      )
      .get(now - 30 * ONE_DAY_MS)?.c ?? 0;

  const lastUpdatedAt =
    db
      .prepare<[], { t: number | null }>('SELECT MAX(updated_at) AS t FROM notes')
      .get()?.t ?? null;

  const topTags = listTagsWithCount().slice(0, topTagLimit);

  return { total, lastWeek, lastMonth, lastUpdatedAt, topTags };
}

// ---------------------------------------------------------------------------
// Tag tree (sidebar)
// ---------------------------------------------------------------------------

export type TagWithNotes = Tag & {
  /** Up to `maxPerTag` most-recent notes that carry this tag. */
  notes: NoteSummary[];
  /** Child tags for two-level hierarchy rendering. */
  children: TagWithNotes[];
};

/**
 * Fetch every note summary, grouped by tag, with at most `maxPerTag`
 * notes per tag (most-recent first). Returns a two-level tree where
 * top-level tags carry their direct children.
 *
 * For a personal KB this is O(notes + tags); use `listTagTree` if
 * you don't need notes attached.
 */
export function listTagsWithNotes(
  opts: { maxPerTag?: number } = {},
): TagWithNotes[] {
  return listTagTree(opts);
}
