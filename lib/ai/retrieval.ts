// RAG-lite chat retrieval.
//
// Pipeline: smart OR-of-tokens FTS5 query (column-weighted, title 10x)
// -> multi-signal re-rank (BM25 base * recency decay 14-day half-life
// * title-exact-match 2x) -> top-k.
//
// We intentionally skip vector embeddings / sqlite-vec for the MVP. The
// user's own keyword query is a perfectly fine retrieval signal for a
// personal KB, and FTS5 + bm25 ranking + recency boost is the same
// primitive every search engine uses.
//
// The "smart query" layer is the main difference between this and a
// naive FTS5 phrase search: we tokenize the user's natural-language
// question, drop Chinese particles / generic stop words, and build an
// OR query so a question like "有哪些 hermes 相关的内容" matches docs
// containing "hermes" (or "相关") -- a plain phrase search would never
// match because the question's exact phrasing doesn't appear verbatim
// in any doc.
//
// If recall ever becomes a problem, swap `searchRelevantNotes` for an
// embedding-based retriever without changing the rest of the pipeline.

import { getDb } from '@/lib/db/client';
import type { NoteSummary } from '@/lib/notes/queries';
import {
  buildFtsOrQuery,
  searchNotesFts,
  type FtsSearchResult,
} from '@/lib/notes/queries';
import {
  detectEmbeddingEnabled,
  embedTexts,
  isEmbeddingEnabled,
  RRF_K_VALUE,
} from '@/lib/ai/embeddings';
import { getChatRetrieveLimit } from '@/lib/auth/init';
import type { RetrievedChunk } from './retrieval-types';

export const CHAT_RETRIEVE_LIMIT_FALLBACK = 5;
const RECENCY_HALF_LIFE_DAYS = 14;
const TITLE_HIT_BOOST = 2.0;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type RetrievedNote = Pick<
  NoteSummary,
  'id' | 'title' | 'tags' | 'updatedAt'
> & {
  contentText: string;
};

/**
 * Chinese stop words and generic tokens that hurt more than they help
 * as FTS5 search terms. We drop them when building the smart OR query
 * for chat retrieval so questions like "有哪些 hermes 相关的内容"
 * collapse to "hermes" + "相关" instead of trying to match every
 * particle verbatim.
 *
 * The list is intentionally limited to words that are essentially never
 * useful as a sole search target. Domain nouns (e.g. "笔记") and
 * generic adjectives (e.g. "相关") are borderline; we err on the side
 * of removing them so the OR query stays focused. A user who wants
 * to search for "笔记" specifically can still do so via the home page
 * list search.
 */
const SMART_QUERY_STOP_WORDS = new Set<string>([
  // Possessive / structural particles
  '的', '地', '得', '所',
  // State / copula / existence
  '是', '在', '了', '着', '过', '有', '没', '没有', '会', '能', '可以',
  // Conjunctions
  '和', '与', '或', '还', '也', '都', '但', '但是', '然而', '不过', '且',
  // Pronouns
  '我', '你', '他', '她', '它', '们', '自己',
  // Demonstratives
  '这', '那', '这个', '那个', '这些', '那些',
  // Interrogatives (almost never useful as a sole search term)
  '什么', '哪', '哪里', '哪些', '哪个', '怎么', '如何', '为什么', '为啥',
  // Modal particles
  '吗', '呢', '吧', '啊', '哦', '呀', '嗯', '嘛',
  // Prepositions
  '从', '到', '给', '对', '于', '把', '被', '让', '向', '以', '为', '跟',
  // Abstract / meta nouns that would match every note
  '内容', '信息', '笔记', '情况', '问题', '方面', '东西', '部分', '里面', '相关',
  // Generic relational
  '有关', '一样', '类似', '关系',
  // Quantifiers
  '一些', '一下', '点', '些', '个', '种', '次', '下',
  // Polite / request words
  '请', '帮我', '想要', '需要', '能否', '麻烦',
  // Action verbs (often commands, not content)
  '讲', '说', '告诉', '看', '找', '查', '写', '列出', '总结', '介绍',
]);

/**
 * Tokenize the user query into keyword fragments. We split on
 * whitespace + CJK punctuation, drop tiny tokens (<2 chars), dedupe.
 * Used to detect title hits for the re-rank boost.
 */
function tokenizeQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[\s,，。、;；:：!！?？()（）\[\]【】"'`~*\\/]+/g)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    ),
  );
}

/**
 * Like `tokenizeQuery` but additionally drops stop words. Returns the
 * raw tokens as a fallback when stop-word removal would leave nothing
 * (e.g. a one-token query that's entirely a stop word -- unlikely but
 * handled gracefully).
 */
function extractSearchTerms(query: string): string[] {
  const tokens = tokenizeQuery(query);
  const meaningful = tokens.filter((t) => !SMART_QUERY_STOP_WORDS.has(t));
  return meaningful.length > 0 ? meaningful : tokens;
}

/**
 * Recency decay: `2^(-days / HALF_LIFE_DAYS)`. Halves every 14 days,
 * asymptotically approaches 0 for very old notes but never below 0.1
 * (so a 2-year-old note is still slightly preferred over a 1-year-old
 * one in a tie).
 */
function recencyBoost(updatedAt: number, now: number = Date.now()): number {
  const days = Math.max(0, (now - updatedAt) / ONE_DAY_MS);
  return Math.max(0.1, Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS));
}

/**
 * Title-hit boost: if any of the query tokens appears in the note's
 * title (case-insensitive), return TITLE_HIT_BOOST; else 1.0.
 */
function titleHitBoost(title: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1.0;
  const t = title.toLowerCase();
  return queryTokens.some((tok) => t.includes(tok)) ? TITLE_HIT_BOOST : 1.0;
}

/**
 * Fetch the content_text of a note (the list view skips it to stay
 * light). Used after FTS5 + re-rank to materialize the top-k matches.
 */
function loadContentText(ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const db = getDb();
  const rows = db
    .prepare<unknown[], { id: string; content_text: string }>(
      `SELECT id, content_text FROM notes WHERE id IN (${placeholders})`,
    )
    .all(...ids);
  return new Map(rows.map((r) => [r.id, r.content_text]));
}

/**
 * Search the notes FTS5 index for `query`, returning the top `limit`
 * matches with multi-signal re-ranking applied.
 *
 * Score = (1 / (1 + bm25))  *  recency_boost  *  title_hit_boost
 *
 * We use `1 / (1 + bm25)` instead of `-bm25` so the score is positive
 * and the multiplicative boosts feel natural (anything > 1 boosts, < 1
 * penalizes).
 */
export function searchRelevantNotes(
  query: string,
  limit?: number,
): RetrievedNote[] {
  const k = limit ?? getChatRetrieveLimit();
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Build the smart FTS5 query: drop stop words, OR the remaining
  // terms. For a question like "有哪些 hermes 相关的内容" this becomes
  // "hermes" OR "相关" -- both single tokens the FTS5 index actually
  // contains, instead of the verbatim phrase that no note matches.
  // Falls back to the original token list if stop-word removal would
  // leave nothing (defensive).
  const ftsQuery = buildFtsOrQuery(extractSearchTerms(trimmed));
  if (!ftsQuery) return [];

  // Fetch more candidates than the final limit, so the re-rank has
  // room to promote / demote.
  const candidateLimit = Math.max(k * 3, 15);
  const candidates = searchNotesFts(trimmed, {
    limit: candidateLimit,
    ftsQuery,
  });
  if (candidates.length === 0) return [];

  // Re-use the un-filtered tokens for the title-hit boost -- a stop word
  // like "的" appearing in a title is still evidence of relevance
  // (better than nothing).
  const queryTokens = tokenizeQuery(trimmed);
  const now = Date.now();

  const scored: Array<{ row: FtsSearchResult; score: number }> = candidates.map(
    (row) => {
      const base = 1 / (1 + row.bm25);
      const score =
        base * recencyBoost(row.updatedAt, now) * titleHitBoost(row.title, queryTokens);
      return { row, score };
    },
  );

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k);
  if (top.length === 0) return [];

  // Materialize the content_text for the survivors
  const contentById = loadContentText(top.map((t) => t.row.id));
  return top.map(({ row }) => ({
    id: row.id,
    title: row.title,
    contentText: contentById.get(row.id) ?? '',
    tags: row.tags,
    updatedAt: row.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Hybrid retrieval (FTS5 + sqlite-vec KNN + RRF)
// ---------------------------------------------------------------------------

const CANDIDATE_LIMIT = 20;

type FtsCandidate = {
  chunkId: number;
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  score: number; // 1 / (1 + bm25)
};

type EmbedCandidate = {
  chunkId: number;
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  score: number; // 1 / (1 + distance)
};

function ftsPath(question: string, limit: number): FtsCandidate[] {
  // The existing FTS5 path searches `notes_fts` (whole notes). For
  // each matching note we surface up to 6 of its chunks, scored by
  // how many query terms they contain (not just note-level bm25).
  // This prevents metadata-only chunks (title, dates) from masking
  // the actual body content when a note was imported from an external
  // source that put metadata at the top of content_text.
  const ftsQuery = buildFtsOrQuery(extractSearchTerms(question));
  if (!ftsQuery) return [];
  const noteHits = searchNotesFts(question, { limit, ftsQuery });
  if (noteHits.length === 0) return [];
  const terms = tokenizeQuery(question);
  const db = getDb();
  const out: FtsCandidate[] = [];
  for (const hit of noteHits) {
    const chunks = db
      .prepare<[string], { id: number; content: string }>(
        'SELECT id, content FROM note_chunks WHERE note_id = ? ORDER BY chunk_index LIMIT 6',
      )
      .all(hit.id);
    if (chunks.length === 0 && hit.preview) {
      // Fallback: note was created before chunks existed, or chunking
      // failed. Synthesise a single chunk from the note's content_text
      // so the AI still has something to work with.
      const content = db
        .prepare<[string], { content_text: string }>(
          'SELECT content_text FROM notes WHERE id = ?',
        )
        .get(hit.id);
      if (content && content.content_text) {
        out.push({
          chunkId: -(out.length + 1), // negative => synthetic, never matches a vec row
          noteId: hit.id,
          title: hit.title,
          content: content.content_text.slice(0, 2000),
          tags: hit.tags,
          score: 1 / (1 + hit.bm25),
        });
      }
      continue;
    }
    for (const c of chunks) {
      // Skip empty or whitespace-only chunks — they waste retrieval
      // slots and degrade re-ranking quality.
      if (!c.content || c.content.trim().length === 0) continue;

      // Score each chunk independently: multiply the note-level bm25
      // by how many query terms appear in this chunk's content.
      // Metadata-only chunks (title, dates, notebook path) get no
      // boost and rank lower than chunks containing the searched terms.
      const lower = c.content.toLowerCase();
      let termHits = 0;
      for (const t of terms) {
        const tl = t.toLowerCase();
        let idx = 0;
        while ((idx = lower.indexOf(tl, idx)) !== -1) {
          termHits++;
          idx += tl.length;
        }
      }
      const noteScore = 1 / (1 + hit.bm25);
      out.push({
        chunkId: c.id,
        noteId: hit.id,
        title: hit.title,
        content: c.content,
        tags: hit.tags,
        score: noteScore * (1 + Math.min(termHits, 5)),
      });
    }
  }
  // Sort by score descending so RRF uses correct rank weights.
  out.sort((a, b) => b.score - a.score);
  return out;
}

async function embeddingPath(question: string, limit: number): Promise<EmbedCandidate[]> {
  if (!isEmbeddingEnabled()) {
    detectEmbeddingEnabled();
  }
  if (!isEmbeddingEnabled()) return [];
  let vectors: number[][];
  try {
    vectors = await embedTexts([question]);
  } catch (err) {
    console.warn(`[retrieval] embedding failed; skipping embedding path: ${(err as Error).message}`);
    return [];
  }
  if (vectors.length === 0) return [];
  const queryVec = vectors[0];

  const db = getDb();
  // sqlite-vec KNN: lower distance is better. vec0's default distance
  // is L2; if the embedding endpoint returns normalized vectors, switch
  // the vec0 distance metric to cosine (see sqlite-vec docs).
  const buf = Buffer.alloc(4 * queryVec.length);
  for (let i = 0; i < queryVec.length; i++) buf.writeFloatLE(queryVec[i], i * 4);
  let rows: { chunk_id: number; distance: number }[];
  try {
    rows = db
      .prepare<[Buffer, number], { chunk_id: number; distance: number }>(
        `SELECT chunk_id, distance
           FROM note_chunks_vec
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT ?`,
      )
      .all(buf, limit);
  } catch (err) {
    console.warn(`[retrieval] vec KNN failed; skipping embedding path: ${(err as Error).message}`);
    return [];
  }

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.chunk_id);
  const placeholders = ids.map(() => '?').join(',');
  const meta = db
    .prepare<unknown[], { id: number; note_id: string; content: string; title: string; tags: string | null }>(
      `SELECT c.id, c.note_id, c.content, n.title,
              (SELECT GROUP_CONCAT(t.name, '|') FROM note_tags nt
                 JOIN tags t ON t.id = nt.tag_id
                WHERE nt.note_id = c.note_id) AS tags
         FROM note_chunks c
         JOIN notes n ON n.id = c.note_id
        WHERE c.id IN (${placeholders})`,
    )
    .all(...ids);
  const metaById = new Map(meta.map((m) => [m.id, m]));
  return rows.map((r) => {
    const m = metaById.get(r.chunk_id);
    return {
      chunkId: r.chunk_id,
      noteId: m?.note_id ?? '',
      title: m?.title ?? '',
      content: m?.content ?? '',
      tags: m?.tags ? m.tags.split('|').filter(Boolean) : [],
      score: 1 / (1 + r.distance),
    };
  });
}

function rrfFuse(
  a: FtsCandidate[],
  b: EmbedCandidate[],
  k: number,
  diversity: number,
): RetrievedChunk[] {
  type Agg = {
    fields: { noteId: string; title: string; content: string; tags: string[] };
    rrf: number;
    paths: Array<'fts' | 'embedding'>;
  };
  const byId = new Map<number, Agg>();

  const ingest = (
    list: Array<{ chunkId: number; noteId: string; title: string; content: string; tags: string[] }>,
    path: 'fts' | 'embedding',
  ): void => {
    list.forEach((c, rank) => {
      const prev = byId.get(c.chunkId);
      const contribution = 1 / (RRF_K_VALUE + rank + 1);
      if (prev) {
        prev.rrf += contribution;
        if (!prev.paths.includes(path)) prev.paths.push(path);
      } else {
        byId.set(c.chunkId, {
          fields: { noteId: c.noteId, title: c.title, content: c.content, tags: c.tags },
          rrf: contribution,
          paths: [path],
        });
      }
    });
  };
  ingest(a, 'fts');
  ingest(b, 'embedding');

  const sorted = Array.from(byId.entries())
    .map(([chunkId, v]) => ({
      chunkId,
      noteId: v.fields.noteId,
      title: v.fields.title,
      content: v.fields.content,
      tags: v.fields.tags,
      score: v.rrf,
      paths: v.paths,
    }))
    .sort((x, y) => y.score - x.score);

  // Diversity cap: at most `diversity` chunks per note in the top k.
  const perNote = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const c of sorted) {
    const used = perNote.get(c.noteId) ?? 0;
    if (used >= diversity) continue;
    perNote.set(c.noteId, used + 1);
    out.push(c);
    if (out.length >= k) break;
  }
  return out;
}

export async function searchRelevantChunks(
  question: string,
  k?: number,
  opts: { diversity?: number } = {},
): Promise<RetrievedChunk[]> {
  const trimmed = question.trim();
  if (!trimmed) return [];
  const limit = k ?? getChatRetrieveLimit();
  const diversity = opts.diversity ?? 2;

  const a = ftsPath(trimmed, CANDIDATE_LIMIT);
  const b = await embeddingPath(trimmed, CANDIDATE_LIMIT);
  return rrfFuse(a, b, limit, diversity);
}
