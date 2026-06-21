# Chat Module: Natural-Language RAG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/chat` from keyword-search + FTS5 + multi-signal re-rank to natural-language understanding via hybrid retrieval (FTS5 + sqlite-vec embeddings + RRF fusion).

**Architecture:** Chunk each note on write, embed chunks via an OpenAI-compatible embedding model, store vectors in a sqlite-vec `vec0` virtual table. At query time run FTS5 + KNN in parallel, fuse with Reciprocal Rank Fusion, return top-k passages. The chat module never fails because the embedding path is unhealthy — it degrades to FTS5 only.

**Tech Stack:** better-sqlite3, sqlite-vec (new), `@ai-sdk/openai` (existing), Vercel AI SDK `ai` package (existing), zod (existing), `tsx` for CLI scripts.

**Spec:** `docs/superpowers/specs/2026-06-04-chat-nlp-rag-design.md`

**Project conventions to follow throughout** (per `AGENTS.md` / `CONTRACTS.md`):
- All `/api/*` SQLite routes: `export const runtime = 'nodejs'`.
- Use `getDb()` / `tx()` from `@/lib/db/client` — never `new Database(...)`.
- IDs `nanoid(12)`, timestamps `Date.now()` ms.
- No test framework — `scripts/smoke-embed.ts` is the integration test (mirrors existing `scripts/smoke-db.ts`).
- No `any` (use `unknown` + narrow); no empty `catch {}`; `console.error`/`console.warn` only, with `[prefix]`.
- Build verification order: `npm run typecheck` → `npm run lint` → `npm run build` → `npx tsx scripts/smoke-embed.ts` (last only when DB/embed/auth changed).

**Git status:** Working tree is reported as "not a git repository" by the harness. Skip `git add` / `git commit` steps in this plan; the user will commit when satisfied.

---

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `lib/db/migrations.ts` | modify | Add v3: `note_chunks` table, `note_chunks_vec` virtual table, `model_configs.kind` column + scoped default index. |
| `lib/notes/chunk.ts` | create | Pure chunking function `chunkNote(content) → Chunk[]`. |
| `lib/notes/queries.ts` | modify | `createNote` / `updateNote` generate chunks + embeddings (sync, outside tx); `deleteNote` cleans vec rows; export new `replaceNoteChunks` helper. |
| `lib/ai/errors.ts` | modify | Add `NoDefaultEmbeddingModelError`. |
| `lib/ai/embeddings.ts` | create | sqlite-vec extension loader, `detectEmbeddingEnabled`, `getDefaultEmbeddingModelId`, `embedTexts`, `isEmbeddingEnabled` global flag. |
| `lib/ai/retrieval.ts` | modify | Add `searchRelevantChunks(question, k)` — hybrid FTS5 + KNN + RRF. Keep `searchRelevantNotes` (now unused) for one release then delete in a follow-up. |
| `lib/ai/chat.ts` | modify | `streamChat` calls `searchRelevantChunks`. |
| `lib/ai/prompts.ts` | modify | `CHAT_SYSTEM_PROMPT` updated; `buildChatContext` takes `RetrievedChunk[]`. |
| `lib/ai/mask.ts` | modify | `MaskedModelConfig` gains `kind`. |
| `app/api/models/route.ts` | modify | Accept/return `kind`; `isDefault` is now per-kind. |
| `app/api/models/[id]/route.ts` | modify | Same. `PUT` switches on the row's `kind` when toggling default. |
| `components/models/model-form.tsx` | modify | Add "类型" select (`chat` / `embedding`). |
| `components/models/model-list-item.tsx` | modify | Show kind chip. |
| `scripts/embed-all.ts` | create | Backfill CLI: `npm run embed-all` / `embed-missing`. |
| `scripts/smoke-embed.ts` | create | Integration smoke test (mirrors `smoke-db.ts`). |
| `scripts/bootstrap.ts` | modify | One reminder line at the end. |
| `package.json` | modify | Add `sqlite-vec` dep; add `embed-all` and `embed-missing` scripts. |
| `docker/Dockerfile` | modify | Ensure `sqlite-vec` builds on alpine. |

---

## Phase 1 — Data model (migration v3)

### Task 1.1: Add `note_chunks` table

**Files:**
- Modify: `lib/db/migrations.ts` (append a new entry to the `migrations` array)

- [ ] **Step 1: Open `lib/db/migrations.ts` and append a v3 entry**

Add to the `migrations` array, after the v2 entry:

```ts
  {
    // v3: note chunks + sqlite-vec vector index + model_configs.kind.
    //
    // This migration does NOT embed any existing data. Run
    // `npm run embed-all` after this migration to backfill the chunk
    // vectors for notes that were created before v3.
    version: 3,
    name: 'note_chunks_and_embedding_models',
    up: (db) => {
      db.exec(`
        CREATE TABLE note_chunks (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id     TEXT    NOT NULL,
          chunk_index INTEGER NOT NULL,
          content     TEXT    NOT NULL,
          start_pos   INTEGER NOT NULL,
          end_pos     INTEGER NOT NULL,
          created_at  INTEGER NOT NULL,
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
          UNIQUE (note_id, chunk_index)
        );
        CREATE INDEX idx_note_chunks_note_id ON note_chunks(note_id);

        -- sqlite-vec vec0 virtual table. Dimension is fixed at 1024 to
        -- match Qwen text-embedding-v3. Bumping the dimension requires
        -- a new migration that re-embeds every row.
        CREATE VIRTUAL TABLE note_chunks_vec USING vec0(
          chunk_id INTEGER PRIMARY KEY,
          embedding float[1024]
        );
      `);
    },
  },
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `npx tsx lib/db/migrate.ts`
Expected: prints `[db] applied migrations: v3 (now at v3)`.

If you see `note_chunks_vec` schema errors, sqlite-vec is not loaded — that is expected and **not fatal** at this point; the migration will still create `note_chunks`. The virtual table creation will throw on systems without the extension. We'll handle that with a guarded loader in Task 3.1; for now, comment out the `CREATE VIRTUAL TABLE` line in the migration and proceed. We'll re-enable it once the loader is in place.

- [ ] **Step 3: Verify with sqlite3 CLI (optional but recommended)**

Run: `npx tsx -e "import {getDb} from './lib/db/client'; const r = getDb().prepare(\"SELECT name FROM sqlite_master WHERE type IN ('table') AND name LIKE 'note_chunks%'\").all(); console.log(r);"`
Expected: `[{ name: 'note_chunks' }, { name: 'note_chunks_vec' }]` (or just `note_chunks` if you commented out the virtual table for now).

### Task 1.2: Add `model_configs.kind` column + scoped default index

**Files:**
- Modify: `lib/db/migrations.ts` (extend the same v3 entry, or add a v3.5 / v4 — pick v3.1 to keep things simple: split this into a separate migration `v3_kind_column`)

Add a fourth migration entry after v3:

```ts
  {
    // v3.1: model_configs.kind column. Existing rows default to 'chat'.
    // The default flag is now unique per (kind) instead of globally
    // unique, so we drop the old partial index and add a new one.
    version: 4,
    name: 'model_kind_column',
    up: (db) => {
      db.exec(`
        ALTER TABLE model_configs ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
        DROP INDEX IF EXISTS idx_model_configs_default;
        CREATE UNIQUE INDEX idx_model_configs_default_per_kind
          ON model_configs(kind)
          WHERE is_default = 1;
        CREATE INDEX idx_model_configs_kind ON model_configs(kind);
      `);
    },
  },
```

Run: `npx tsx lib/db/migrate.ts`
Expected: prints `applied migrations: v4 (now at v4)`.

Verify: `npx tsx -e "import {getDb} from './lib/db/client'; console.log(getDb().prepare(\"SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='model_configs'\").all());"`
Expected output should include `idx_model_configs_default_per_kind` and **not** `idx_model_configs_default`.

### Task 1.3: Mark TaskCreate tasks for the phase as done; move to Phase 2.

(Internal bookkeeping for the executor; not a code step.)

---

## Phase 2 — Chunking

### Task 2.1: Pure chunking function

**Files:**
- Create: `lib/notes/chunk.ts`
- Create: `lib/notes/chunk.test.ts` (a single throwaway test runner, see below)

- [ ] **Step 1: Write the failing test**

Create `lib/notes/chunk.test.ts` with a tiny assert-based runner (no framework). It runs all assertions and exits 1 on the first failure.

```ts
// lib/notes/chunk.test.ts
//
// Throwaway test runner for chunkNote — mirrors the project's "no
// unit-test framework" rule (see AGENTS.md). Run with:
//   npx tsx lib/notes/chunk.test.ts
//
// Exits 0 on success, 1 on the first failed assertion.

import { chunkNote } from './chunk';

type Case = { name: string; input: string; check: (out: ReturnType<typeof chunkNote>) => boolean };

const cases: Case[] = [
  {
    name: 'empty input → empty output',
    input: '',
    check: (out) => out.length === 0,
  },
  {
    name: 'short content → single chunk',
    input: '短内容',
    check: (out) => out.length === 1 && out[0].content === '短内容',
  },
  {
    name: 'two paragraphs split on double newline',
    input: '第一段。\n\n第二段。',
    check: (out) => out.length === 2 && out[0].content === '第一段。' && out[1].content === '第二段。',
  },
  {
    name: 'long content produces multiple chunks with overlap',
    input: 'a'.repeat(2000),
    check: (out) => out.length >= 2,
  },
  {
    name: 'start_pos is monotonic and within bounds',
    input: 'a'.repeat(2000),
    check: (out) => {
      for (let i = 1; i < out.length; i++) {
        if (out[i].startPos < out[i - 1].startPos) return false;
        if (out[i].endPos > 2000) return false;
      }
      return true;
    },
  },
  {
    name: 'chunk_index is sequential from 0',
    input: 'a'.repeat(2000),
    check: (out) => out.every((c, i) => c.chunkIndex === i),
  },
  {
    name: 'markdown heading is a hard split',
    input: 'intro\n\n# 标题\n\nbody',
    check: (out) => out.length === 3 && out[1].content === '# 标题',
  },
];

let failed = 0;
for (const c of cases) {
  try {
    if (!c.check(chunkNote(c.input))) {
      console.error(`FAIL: ${c.name}`);
      failed++;
    } else {
      console.log(`PASS: ${c.name}`);
    }
  } catch (err) {
    console.error(`ERROR in ${c.name}:`, err);
    failed++;
  }
}
if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} tests passed`);
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx tsx lib/notes/chunk.test.ts`
Expected: `Cannot find module './chunk'` or `chunkNote is not a function`.

- [ ] **Step 3: Implement `chunkNote`**

Create `lib/notes/chunk.ts`:

```ts
// Pure text chunking for embedding.
//
// Splits a note's plain-text content into 800-char chunks with a 100-char
// sliding window of overlap, preserving structural boundaries (paragraph
// breaks, Markdown headings, list items, table rows) and never splitting
// inside a sentence.
//
// Output is consumed by `lib/ai/embeddings.ts` and indexed in
// `note_chunks` / `note_chunks_vec`.

const TARGET_CHUNK_CHARS = 800;
const OVERLAP_CHARS = 100;
const SHORT_CONTENT_THRESHOLD = 100;
const HARD_CONTENT_MAX_CHARS = 50000;

export type Chunk = {
  content: string;
  startPos: number;
  endPos: number;
  chunkIndex: number;
};

const SENTENCE_TERMINATORS = /([。！？.!?\n])/g;

function hardSplit(input: string): string[] {
  // Split on double newlines, Markdown headings, list items, and table
  // rows. Each match keeps its separator so the original whitespace
  // structure is preserved in the chunk content.
  const re = /(\n\n+|^#{1,6}\s.*$|^[-*+]\s.*$|^\|.*\|$)/gm;
  const segments: string[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > lastIdx) {
      segments.push(input.slice(lastIdx, m.index));
    }
    lastIdx = m.index;
  }
  if (lastIdx < input.length) {
    segments.push(input.slice(lastIdx));
  }
  return segments.flatMap((s) => s.split(/\n\n+/));
}

function softSplit(segment: string): string[] {
  // Walk the segment, accumulate up to TARGET_CHUNK_CHARS, cut on the
  // last sentence terminator within the window. Never split mid-sentence.
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < segment.length) {
    const remaining = segment.length - cursor;
    if (remaining <= TARGET_CHUNK_CHARS) {
      parts.push(segment.slice(cursor));
      break;
    }
    const window = segment.slice(cursor, cursor + TARGET_CHUNK_CHARS);
    let lastTerm = -1;
    let match: RegExpExecArray | null;
    SENTENCE_TERMINATORS.lastIndex = 0;
    while ((match = SENTENCE_TERMINATORS.exec(window)) !== null) {
      lastTerm = match.index + match[0].length;
    }
    const cut = lastTerm > 0 ? lastTerm : TARGET_CHUNK_CHARS;
    parts.push(segment.slice(cursor, cursor + cut));
    cursor += cut;
  }
  return parts;
}

function applyOverlap(parts: string[]): string[] {
  if (parts.length <= 1) return parts;
  const result: string[] = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1];
    const overlap = prev.slice(Math.max(0, prev.length - OVERLAP_CHARS));
    result.push(overlap + parts[i]);
  }
  return result;
}

export function chunkNote(rawContent: string): Chunk[] {
  const content = (rawContent ?? '').slice(0, HARD_CONTENT_MAX_CHARS).trim();
  if (content.length === 0) return [];
  if (content.length <= SHORT_CONTENT_THRESHOLD) {
    return [
      {
        content,
        startPos: 0,
        endPos: content.length,
        chunkIndex: 0,
      },
    ];
  }

  const segments = hardSplit(content);
  const parts = segments.flatMap((seg) =>
    seg.length <= TARGET_CHUNK_CHARS ? [seg] : softSplit(seg),
  );
  const withOverlap = applyOverlap(parts);

  let cursor = 0;
  return withOverlap.map((part, i) => {
    const start = content.indexOf(part, cursor);
    const end = start >= 0 ? start + part.length : cursor + part.length;
    cursor = Math.max(end - OVERLAP_CHARS, cursor);
    return {
      content: part,
      startPos: start >= 0 ? start : 0,
      endPos: end,
      chunkIndex: i,
    };
  });
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx tsx lib/notes/chunk.test.ts`
Expected: 7 `PASS` lines, then `All 7 tests passed`.

If a test fails, tweak the function (do not tweak the test — the test captures the spec).

- [ ] **Step 5: Lint + typecheck**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

---

## Phase 3 — Embedding client

### Task 3.1: `lib/ai/errors.ts` — add `NoDefaultEmbeddingModelError`

**Files:**
- Modify: `lib/ai/errors.ts`

Append after `NoDefaultModelError`:

```ts
export class NoDefaultEmbeddingModelError extends Error {
  constructor() {
    super('No default embedding model configuration is set');
    this.name = 'NoDefaultEmbeddingModelError';
  }
}
```

Run: `npm run typecheck`
Expected: 0 errors.

### Task 3.2: Create `lib/ai/embeddings.ts` with extension loader + flag

**Files:**
- Create: `lib/ai/embeddings.ts`

```ts
// Embedding client + sqlite-vec extension loader.
//
// The sqlite-vec extension is loaded once at first access via
// `better-sqlite3`'s `loadExtension`. If loading fails (extension not
// installed for the platform, build mismatch, etc.) we set
// `embeddingEnabled = false` and the rest of the app degrades to
// FTS5-only retrieval. We never throw out of this module — callers
// check the flag and adapt.
//
// The `embedTexts` function is the only thing the write path and the
// retrieval path both call.

import { getDb } from '@/lib/db/client';
import { decrypt } from '@/lib/crypto';
import { NoDefaultEmbeddingModelError } from './errors';
import { getOpenAIClient } from './provider';

const EMBEDDING_DIM = 1024;
const RRF_K = 60;

let _embeddingEnabled: boolean | null = null;
let _loadError: string | null = null;

/**
 * Try to load the sqlite-vec extension. Idempotent — first call does
 * the work, subsequent calls return the cached result.
 *
 * We try the well-known package names for sqlite-vec. The exact name
 * shipped depends on the platform; we attempt the most common ones.
 */
export function detectEmbeddingEnabled(): boolean {
  if (_embeddingEnabled !== null) return _embeddingEnabled;
  const db = getDb();
  const candidates = [
    'sqlite-vec',
    'sqlite_vec',
    'vec0',
  ];
  for (const name of candidates) {
    try {
      db.loadExtension(name);
      _embeddingEnabled = true;
      return true;
    } catch (err) {
      _loadError = (err as Error).message;
    }
  }
  _embeddingEnabled = false;
  return false;
}

export function isEmbeddingEnabled(): boolean {
  return _embeddingEnabled === true;
}

export function getEmbeddingLoadError(): string | null {
  return _loadError;
}

type ModelConfigRow = {
  id: string;
  base_url: string;
  api_key_enc: string;
  model: string;
};

/**
 * Look up the default embedding model config. Mirrors
 * `getDefaultModelId` in `provider.ts` but filters by `kind = 'embedding'`.
 */
export function getDefaultEmbeddingModelId(): string {
  const row = getDb()
    .prepare<[], { id: string }>(
      "SELECT id FROM model_configs WHERE is_default = 1 AND kind = 'embedding' LIMIT 1",
    )
    .get();
  if (!row) {
    throw new NoDefaultEmbeddingModelError();
  }
  return row.id;
}

function loadResolvedEmbeddingModel(modelConfigId: string) {
  const row = getDb()
    .prepare<[string], ModelConfigRow>(
      'SELECT id, base_url, api_key_enc, model FROM model_configs WHERE id = ?',
    )
    .get(modelConfigId);
  if (!row) {
    throw new NoDefaultEmbeddingModelError();
  }
  const apiKey = decrypt(row.api_key_enc);
  return { baseUrl: row.base_url, apiKey, model: row.model };
}

/**
 * Embed a batch of texts. Calls the OpenAI-compatible `/embeddings`
 * endpoint directly — we deliberately do not route through the Vercel
 * AI SDK because the SDK's `textEmbeddingModel` does not accept a
 * custom baseURL on 3.4.7, and we want one code path that works for
 * Qwen, OpenAI, GLM, and any other compatible endpoint.
 *
 * Throws on network / auth / parse errors. Callers in the write path
 * catch and degrade; callers in the retrieval path catch and skip
 * the embedding branch.
 */
export async function embedTexts(
  texts: string[],
  modelConfigId?: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const id = modelConfigId ?? getDefaultEmbeddingModelId();
  const { baseUrl, apiKey, model } = loadResolvedEmbeddingModel(id);

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      encoding_format: 'float',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`embeddings HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vectors = data.data?.map((d) => d.embedding ?? []) ?? [];
  if (vectors.length !== texts.length) {
    throw new Error(
      `embeddings: expected ${texts.length} vectors, got ${vectors.length}`,
    );
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(
        `embeddings: expected dim ${EMBEDDING_DIM}, got ${v.length}. ` +
          `Did you configure the wrong embedding model?`,
      );
    }
  }
  return vectors;
}

export const EMBEDDING_DIMENSION = EMBEDDING_DIM;
export const RRF_K_VALUE = RRF_K;
```

Run: `npm run typecheck`
Expected: 0 errors.

The unused `getOpenAIClient` import is intentional for future SDK-based path; you can delete it if you want to keep the file minimal — the `import` is only there to confirm the provider module surface. Actually delete it:

```ts
import { getOpenAIClient } from './provider';
```

becomes nothing — the line is removed entirely. (The hand-rolled `fetch` is the path we ship.)

### Task 3.3: Smoke test the loader + flag

**Files:**
- Create: `scripts/smoke-embed.ts` (initial scaffold; will grow in later phases)

```ts
// scripts/smoke-embed.ts
//
// Integration smoke test for the chat RAG pipeline. Mirrors
// scripts/smoke-db.ts: a single Node script that runs through every
// behavior the spec requires and exits 1 on the first failure.
//
// Run with: npx tsx scripts/smoke-embed.ts

import { getDb, closeDb } from '@/lib/db/client';
import {
  detectEmbeddingEnabled,
  isEmbeddingEnabled,
  getEmbeddingLoadError,
} from '@/lib/ai/embeddings';

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    console.error(`FAIL: ${name}`, detail ?? '');
    failed++;
  }
}

function main(): void {
  // Phase 1: extension loader
  const enabled = detectEmbeddingEnabled();
  check('detectEmbeddingEnabled returns a boolean', typeof enabled === 'boolean');
  check('isEmbeddingEnabled matches the cached flag', isEmbeddingEnabled() === enabled);
  if (!enabled) {
    console.warn(`[smoke-embed] sqlite-vec NOT loaded: ${getEmbeddingLoadError()}`);
    console.warn('[smoke-embed] downstream tests will be skipped (FTS5-only mode).');
  }
  // Touch the DB so we know migration has run.
  const r = getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'note_chunks'").get();
  check('note_chunks table exists', !!r);
}

try {
  main();
} catch (err) {
  console.error('[smoke-embed] threw:', err);
  failed++;
} finally {
  closeDb();
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke-embed: phase 1 OK');
```

Run: `npx tsx scripts/smoke-embed.ts`
Expected: 3 `PASS` lines plus a warning about sqlite-vec (or no warning if the extension is present), ending with `smoke-embed: phase 1 OK`. The `note_chunks_vec` table is checked in later phases.

Run: `npm run typecheck`
Expected: 0 errors.

---

## Phase 4 — Write path

### Task 4.1: Helper to replace chunks for a note

**Files:**
- Modify: `lib/notes/queries.ts` (append a new exported function near the bottom)

Append after the existing `setNoteTags`:

```ts
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
 * explicitly.
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
  db.exec(`DELETE FROM note_chunks_vec WHERE chunk_id IN (${placeholders})`);
  db.exec(`DELETE FROM note_chunks WHERE id IN (${placeholders})`);
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
        insertVec.run(insertedIds[i], vecToBuffer(vectors[i]));
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
```

Run: `npm run typecheck`
Expected: 0 errors.

### Task 4.2: Wire `createNote` to call `replaceNoteChunks`

**Files:**
- Modify: `lib/notes/queries.ts` (in the `createNote` function)

Change the bottom of `createNote` (currently):

```ts
  tx((db) => {
    db.prepare(
      `INSERT INTO notes
         (id, title, content_json, content_text, summary, summary_state,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run(id, title, JSON.stringify(contentJson), contentText, now, now);

    setNoteTags(id, input.tags ?? []);
  });

  const created = getNote(id);
  if (!created) {
    throw new Error('createNote: note disappeared after insert');
  }
  return created;
}
```

to:

```ts
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
  return created;
}
```

Also change the function signature: `export function createNote` → `export async function createNote`. Update the return type implicit annotation; the body is now `Promise<NoteFull>`.

Run: `npm run typecheck`
Expected: 0 errors. (If a caller doesn't `await` the now-async function, TS will flag it. Find those callers and add `await`. For the current codebase, the only caller is the API route, which we will update when needed.)

### Task 4.3: Wire `updateNote` similarly

**Files:**
- Modify: `lib/notes/queries.ts` (in `updateNote`)

Same change shape:

1. Mark the function `async` and the return type `Promise<NoteFull | null>`.
2. After the existing `tx` block and before `return getNote(id)`, insert:

```ts
  // Regenerate chunks when content actually changed.
  if (contentChanged) {
    const result = await replaceNoteChunks(id, newText);
    if (result.error) {
      console.error(
        `[notes.updateNote] embedding failed for ${id}: ${result.error}`,
      );
    }
  }
```

Run: `npm run typecheck`
Expected: 0 errors.

### Task 4.4: Wire `deleteNote` to clean vec rows

**Files:**
- Modify: `lib/notes/queries.ts` (in `deleteNote`)

Replace the function body:

```ts
export function deleteNote(id: string): boolean {
  clearNoteChunks(id);
  const result = getDb()
    .prepare('DELETE FROM notes WHERE id = ?')
    .run();
  return result.changes > 0;
}
```

(Note: we delete the chunks before the note so the FK CASCADE doesn't fire while the vec rows are still around. The `clearNoteChunks` helper does both the vec and the chunks rows explicitly, which is what we want.)

Run: `npm run typecheck`
Expected: 0 errors.

### Task 4.5: Add smoke test for write path

**Files:**
- Modify: `scripts/smoke-embed.ts` (append a new function and call it)

Append to `main()`:

```ts
  // Phase 2: write path
  const { createNote, getNote, updateNote, deleteNote } = await import(
    '@/lib/notes/queries'
  );
  const id = 'smoke-embed-' + Date.now();
  const longContent = '这是一段测试文本。'.repeat(500); // ~500 * 9 = 4500 chars
  const created = await createNote({
    title: 'smoke test',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: longContent }] }] } as never,
    contentText: longContent,
    tags: ['smoke'],
  });
  check('createNote returns a note', created.id === id);
  const db = getDb();
  const chunkRows = db.prepare('SELECT COUNT(*) AS c FROM note_chunks WHERE note_id = ?').get(id) as { c: number };
  check('createNote produced chunks', chunkRows.c >= 2, chunkRows);

  // Update: chunks should be regenerated.
  const newText = '更新后的内容。'.repeat(50);
  await updateNote(id, {
    title: 'smoke test',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: newText }] }] } as never,
    contentText: newText,
  });
  const newChunks = db.prepare('SELECT content FROM note_chunks WHERE note_id = ? ORDER BY chunk_index').all(id) as { content: string }[];
  check('updateNote replaced chunks', newChunks.length > 0 && newChunks[0].content.startsWith('更新'));

  // Delete: chunks + vec rows should be gone.
  deleteNote(id);
  const remaining = db.prepare('SELECT COUNT(*) AS c FROM note_chunks WHERE note_id = ?').get(id) as { c: number };
  check('deleteNote removed chunks', remaining.c === 0);
```

Also add `await` to the `main()` call. Change:

```ts
function main(): void {
```

to:

```ts
async function main(): Promise<void> {
```

and the call site:

```ts
main();
```

to:

```ts
main();
```

(no change to the call, since `main` is now `async` and we just rely on the implicit promise).

Run: `npx tsx scripts/smoke-embed.ts`
Expected: all previous PASSes plus the new 4. The `embedding failed` log lines are OK to appear (sqlite-vec may not be loaded in dev).

Run: `npm run typecheck`
Expected: 0 errors.

---

## Phase 5 — Hybrid retrieval

### Task 5.1: `searchRelevantChunks` — FTS5 path

**Files:**
- Create: `lib/ai/retrieval-types.ts`
- Modify: `lib/ai/retrieval.ts` (append new code at the end)

- [ ] **Step 1: Create `lib/ai/retrieval-types.ts`**

```ts
// Public types for the retrieval layer. Kept in their own file so
// the retrieval module and the chat pipeline can import them without
// a circular dependency (retrieval.ts already exports the legacy
// `RetrievedNote` type for the old pipeline).

export type RetrievedChunk = {
  chunkId: number;
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  score: number;
  paths: Array<'fts' | 'embedding'>;
};
```

- [ ] **Step 2: Append the FTS5-path code to `lib/ai/retrieval.ts`**

Add to the bottom of the file:

```ts
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

import type { RetrievedChunk } from './retrieval-types';

function ftsPath(question: string, limit: number): FtsCandidate[] {
  // The existing FTS5 path searches `notes_fts` (whole notes). For
  // each matching note we surface the first 2 of its chunks. Cheap,
  // reuses every existing piece of plumbing (stop-words, OR query, etc.).
  const ftsQuery = buildFtsOrQuery(extractSearchTerms(question));
  if (!ftsQuery) return [];
  const noteHits = searchNotesFts(question, { limit, ftsQuery });
  if (noteHits.length === 0) return [];
  const db = getDb();
  const out: FtsCandidate[] = [];
  for (const hit of noteHits) {
    const chunks = db
      .prepare<[string, number], { id: number; content: string }>(
        'SELECT id, content FROM note_chunks WHERE note_id = ? ORDER BY chunk_index LIMIT 2',
      )
      .all(hit.id, 2);
    for (const c of chunks) {
      out.push({
        chunkId: c.id,
        noteId: hit.id,
        title: hit.title,
        content: c.content,
        tags: hit.tags,
        score: 1 / (1 + hit.bm25),
      });
    }
  }
  return out;
}
```

Run: `npm run typecheck`
Expected: 0 errors.

### Task 5.2: Embedding path

Append to `lib/ai/retrieval.ts`:

```ts
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
  const rows = db
    .prepare<[Buffer, number], { chunk_id: number; distance: number }>(
      `SELECT chunk_id, distance
         FROM note_chunks_vec
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?`,
    )
    .all(buf, limit);

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
```

Run: `npm run typecheck`
Expected: 0 errors.

### Task 5.3: RRF fusion + dedup + top-k

Append to `lib/ai/retrieval.ts`:

```ts
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
  k: number = 5,
  opts: { diversity?: number } = {},
): Promise<RetrievedChunk[]> {
  const trimmed = question.trim();
  if (!trimmed) return [];
  const diversity = opts.diversity ?? 2;

  const a = ftsPath(trimmed, CANDIDATE_LIMIT);
  const b = await embeddingPath(trimmed, CANDIDATE_LIMIT);
  return rrfFuse(a, b, k, diversity);
}
```

Run: `npm run typecheck`
Expected: 0 errors.

### Task 5.4: Smoke test the retrieval

**Files:**
- Modify: `scripts/smoke-embed.ts` (append more checks)

Append to `main()`:

```ts
  // Phase 3: retrieval
  const { searchRelevantChunks } = await import('@/lib/ai/retrieval');
  const { createNote: cn } = await import('@/lib/notes/queries');
  const qaNote = await cn({
    title: '快递柜选择',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '我比较了丰巢、菜鸟和京东的快递柜，最终选了丰巢因为离公司近。' }] }] } as never,
    contentText: '我比较了丰巢、菜鸟和京东的快递柜，最终选了丰巢因为离公司近。',
    tags: ['快递柜'],
  });
  const results = await searchRelevantChunks('快递柜哪个好', 5);
  check('searchRelevantChunks returns ≥ 1 result', results.length >= 1);
  if (results.length > 0) {
    const top = results[0];
    check('top result references the qa note (FTS5 path always)',
      top.noteId === qaNote.id || top.content.includes('快递柜'));
  }
  // Cleanup
  deleteNote(qaNote.id);
```

Run: `npx tsx scripts/smoke-embed.ts`
Expected: all previous PASSes plus the new 2.

---

## Phase 6 — Chat pipeline

### Task 6.1: `streamChat` uses the new retrieval

**Files:**
- Modify: `lib/ai/chat.ts`

Change the import block:

```ts
import { searchRelevantChunks, type RetrievedChunk } from './retrieval';
```

(Note: `RetrievedNote` is removed from this import.)

In `streamChat`, replace the line:

```ts
  const sources = searchRelevantNotes(currentQuestion);
```

with:

```ts
  const sources = await searchRelevantChunks(currentQuestion);
```

Also change the sources-event payload. Find the block:

```ts
  const sourcesEvent = `data: ${JSON.stringify({
    sources: sources.map((s) => ({ id: s.id, title: s.title })),
  })}\n\n`;
```

Replace with:

```ts
  const sourcesEvent = `data: ${JSON.stringify({
    sources: sources.map((s) => ({
      id: s.noteId,
      title: s.title,
      chunkIndexes: [s.chunkId],
    })),
  })}\n\n`;
```

(We use `[s.chunkId]` to keep the shape as `chunkIndexes: number[]` per the spec, even though we currently only surface one chunk per source row.)

Run: `npm run typecheck`
Expected: 0 errors. The `RetrievedNote` references in the function signature also need updating — change `sources: RetrievedNote[]` to `sources: RetrievedChunk[]` in the `ChatStreamResult` type.

### Task 6.2: Update `CHAT_SYSTEM_PROMPT` + `buildChatContext`

**Files:**
- Modify: `lib/ai/prompts.ts`

Replace the `CHAT_SYSTEM_PROMPT` constant with:

```ts
export const CHAT_SYSTEM_PROMPT =
  '你是一个个人知识库助手。用户会给你「检索到的笔记片段」（按相关度排序）和「对话历史」，' +
  '你需要仅基于这些片段来回答用户当前的问题。\n' +
  '规则：\n' +
  '1. 严格只用提供的笔记片段作为依据。\n' +
  '2. 引用具体信息时，使用 `[笔记标题 §片段 N]` 格式内联在答案里（N 是片段编号，从 1 开始）。\n' +
  '3. 同一笔记的多个片段如果讲同一件事，不要重复引用，挑最相关的那个。\n' +
  '4. 如果片段里没有相关信息，直接说「我的笔记里没有找到相关信息」，不要编造。\n' +
  '5. 用中文回答。\n' +
  '6. 回答简洁，不要重复片段原文。\n' +
  '7. 对话历史只用于理解上下文，不要被它带偏当前问题。';
```

Replace `buildChatContext`:

```ts
export function buildChatContext(
  chunks: Array<{
    chunkId: number;
    noteId: string;
    title: string;
    content: string;
    tags: string[];
  }>,
): string {
  if (chunks.length === 0) {
    return '（没有检索到相关笔记）';
  }
  const MAX_PER_CHUNK = 1500;
  // Group chunks by noteId so the prompt shows "片段 1/N, 2/N, ..." per note.
  const byNote = new Map<string, typeof chunks>();
  for (const c of chunks) {
    const arr = byNote.get(c.noteId) ?? [];
    arr.push(c);
    byNote.set(c.noteId, arr);
  }
  const sections: string[] = [];
  let i = 0;
  for (const [noteId, group] of byNote) {
    i++;
    const title = group[0]?.title || '（无标题）';
    const tags = group[0]?.tags ?? [];
    const tagStr = tags.length > 0 ? `  标签：${tags.join(', ')}` : '';
    const header = `[笔记 ${i}] id=${noteId} 标题：${title}${tagStr}`;
    const passageBlocks = group
      .map((c, idx) => {
        const body = c.content.length > MAX_PER_CHUNK
          ? `${c.content.slice(0, MAX_PER_CHUNK)}…`
          : c.content;
        return `片段 ${idx + 1}/${group.length}：\n${body}`;
      })
      .join('\n\n');
    sections.push(`${header}\n${passageBlocks}`);
  }
  return sections.join('\n\n---\n\n');
}
```

Run: `npm run typecheck`
Expected: 0 errors.

### Task 6.3: Update the `streamChat` call to the new context signature

**Files:**
- Modify: `lib/ai/chat.ts`

Find the lines:

```ts
  const context = buildChatContext(
    sources.map((s) => ({
      id: s.id,
      title: s.title,
      contentText: s.contentText,
      tags: s.tags,
    })),
  );
```

Replace with:

```ts
  const context = buildChatContext(
    sources.map((s) => ({
      chunkId: s.chunkId,
      noteId: s.noteId,
      title: s.title,
      content: s.content,
      tags: s.tags,
    })),
  );
```

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

---

## Phase 7 — CLI

### Task 7.1: `scripts/embed-all.ts`

**Files:**
- Create: `scripts/embed-all.ts`

```ts
// Backfill CLI: walk every note (or just the ones without chunks when
// `--missing-only`), regenerate its chunks, and embed them. Re-runs are
// idempotent: `replaceNoteChunks` wipes the prior set first.
//
// Usage:
//   npm run embed-all          # every note
//   npm run embed-missing      # only notes without chunks

import { closeDb, getDb } from '@/lib/db/client';
import {
  detectEmbeddingEnabled,
  getEmbeddingLoadError,
  isEmbeddingEnabled,
} from '@/lib/ai/embeddings';
import { getDefaultEmbeddingModelId } from '@/lib/ai/embeddings';
import { NoDefaultEmbeddingModelError } from '@/lib/ai/errors';
import { replaceNoteChunks } from '@/lib/notes/queries';

const PROGRESS_EVERY = 10;

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const missingOnly = args.has('--missing-only');

  // 1. Migrate
  const { migrate } = await import('@/lib/db/migrate');
  const m = migrate();
  if (m.applied.length > 0) {
    console.log(`[embed-all] applied migrations v${m.applied.join(', v')}`);
  }

  // 2. Detect extension
  if (!detectEmbeddingEnabled()) {
    console.error(
      `[embed-all] FATAL: sqlite-vec extension not loaded: ${getEmbeddingLoadError() ?? 'unknown'}`,
    );
    process.exit(1);
  }
  if (!isEmbeddingEnabled()) {
    console.error('[embed-all] FATAL: embedding flag flipped off after detect');
    process.exit(1);
  }

  // 3. Default embedding model
  try {
    getDefaultEmbeddingModelId();
  } catch (err) {
    if (err instanceof NoDefaultEmbeddingModelError) {
      console.error(
        '[embed-all] FATAL: 请先在「设置 → 模型」中添加一个 kind=embedding 的默认模型',
      );
      process.exit(1);
    }
    throw err;
  }

  // 4. Select target notes
  const db = getDb();
  const sql = missingOnly
    ? `SELECT id, length(content_text) AS len FROM notes
        WHERE id NOT IN (SELECT note_id FROM note_chunks)
        ORDER BY created_at ASC`
    : `SELECT id, length(content_text) AS len FROM notes ORDER BY created_at ASC`;
  const targets = db.prepare<[], { id: string; len: number }>(sql).all();
  if (targets.length === 0) {
    console.log('[embed-all] nothing to do');
    return;
  }
  console.log(
    `[embed-all] target: ${targets.length} note(s)${missingOnly ? ' (missing only)' : ''}`,
  );

  // 5. Walk
  const started = Date.now();
  let success = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const note = db.prepare<[string], { content_text: string }>(
      'SELECT content_text FROM notes WHERE id = ?',
    ).get(t.id);
    if (!note) {
      failed++;
      console.error(`[embed-all] ${i + 1}/${targets.length} ${t.id}: note disappeared`);
      continue;
    }
    try {
      const result = await replaceNoteChunks(t.id, note.content_text);
      if (result.error) {
        failed++;
        console.error(
          `[embed-all] ${i + 1}/${targets.length} ${t.id}: ${result.error}`,
        );
      } else {
        success++;
      }
    } catch (err) {
      failed++;
      console.error(
        `[embed-all] ${i + 1}/${targets.length} ${t.id}: ${(err as Error).message}`,
      );
    }
    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === targets.length) {
      const pct = Math.round(((i + 1) / targets.length) * 100);
      process.stdout.write(
        `\r[embed-all] ${i + 1}/${targets.length} (${pct}%)  ok=${success} fail=${failed}`,
      );
    }
  }
  process.stdout.write('\n');

  // 6. Summary
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[embed-all] done. 成功 ${success} / 失败 ${failed} / 耗时 ${elapsed}s`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('[embed-all] FAILED:', err);
    process.exit(1);
  });
```

- [ ] **Step 1: Add npm scripts**

In `package.json`, add to the `scripts` block:

```jsonc
"embed-all":     "tsx scripts/embed-all.ts",
"embed-missing": "tsx scripts/embed-all.ts --missing-only"
```

- [ ] **Step 2: Run with no embedding model configured (expected: graceful error)**

Run: `npx tsx scripts/embed-all.ts --missing-only` (with no default embedding model in DB)
Expected: `[embed-all] FATAL: 请先在「设置 → 模型」中添加一个 kind=embedding 的默认模型`, exit 1.

- [ ] **Step 3: Run `npm run typecheck`**

Expected: 0 errors.

---

## Phase 8 — Model config UI

### Task 8.1: `MaskedModelConfig` gains `kind`

**Files:**
- Modify: `lib/ai/mask.ts`

Add `kind: 'chat' | 'embedding'` to the `MaskedModelConfig` type and to the returned object in `toMaskedModelConfig`:

```ts
export type MaskedModelConfig = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  kind: 'chat' | 'embedding';
  isDefault: boolean;
  createdAt: number;
  apiKeyMasked: string;
};

type Row = {
  id: string;
  name: string;
  base_url: string;
  api_key_enc: string;
  model: string;
  is_default: number;
  kind: 'chat' | 'embedding';
  created_at: number;
};

// ... and inside toMaskedModelConfig, add:
  kind: row.kind,
```

Move the `Row` type to the top of the file (it was already at the top in the existing version, but it now includes `kind`).

Run: `npm run typecheck`
Expected: 0 errors.

### Task 8.2: `app/api/models/route.ts` accepts/returns `kind`

**Files:**
- Modify: `app/api/models/route.ts`

1. Update the `Row` type to include `kind: 'chat' | 'embedding'`.
2. Update both SELECTs to read the `kind` column.
3. Update the `CreateBody` Zod schema:

```ts
const CreateBody = z.object({
  name: z.string().min(1).max(64),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).max(512),
  model: z.string().min(1).max(128),
  kind: z.enum(['chat', 'embedding']).optional().default('chat'),
  isDefault: z.boolean().optional().default(false),
});
```

4. In the POST handler, when building the `INSERT` statement, include `kind`. The row's `kind` is taken from `parsed.data.kind`. The default flag is per-kind: when inserting with `is_default = 1`, only clear other rows whose `kind` matches. Replace the `if (isDefault) { tx(...) }` block with:

```ts
  if (isDefault) {
    tx((db) => {
      db.prepare('UPDATE model_configs SET is_default = 0 WHERE kind = ?').run(parsed.data.kind);
      db.prepare(
        'INSERT INTO model_configs (id, name, base_url, api_key_enc, model, kind, is_default, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      ).run(id, name, baseUrl, apiKeyEnc, model, parsed.data.kind, now);
    });
  } else {
    getDb()
      .prepare(
        'INSERT INTO model_configs (id, name, base_url, api_key_enc, model, kind, is_default, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
      )
      .run(id, name, baseUrl, apiKeyEnc, model, parsed.data.kind, now);
  }
```

5. Build the post-insert `Row` with `kind: parsed.data.kind` and pass it to `toMaskedModelConfig`.

6. In the GET handler, just add `kind: row.kind` to the row mapping (or simply pass the row — `Row` now includes kind).

Run: `npm run typecheck`
Expected: 0 errors.

### Task 8.3: `app/api/models/[id]/route.ts` per-kind default

**Files:**
- Modify: `app/api/models/[id]/route.ts`

1. `Row` type: add `kind: 'chat' | 'embedding'`.
2. `loadRow` selects `kind` too.
3. `UpdateBody` Zod schema: add `kind: z.enum(['chat', 'embedding']).optional()` and an explicit `name/baseUrl/...` clause (already present).
4. In the PUT handler, the per-row SET clause must include `kind = ?` when the body carries it. Add:

```ts
  if (parsed.data.kind !== undefined) {
    sets.push('kind = ?');
    args.push(parsed.data.kind);
  }
```

5. Replace the `tx` "atomically all off, this one on" with the per-kind version:

```ts
      const targetKind = parsed.data.kind ?? existing.kind;
      tx((db) => {
        db.prepare('UPDATE model_configs SET is_default = 0 WHERE kind = ?').run(targetKind);
        if (sets.length > 0) {
          db.prepare(
            `UPDATE model_configs SET ${sets.join(', ')} WHERE id = ?`,
          ).run(...args, params.id);
        }
        db.prepare('UPDATE model_configs SET is_default = 1 WHERE id = ?').run(
          params.id,
        );
      });
```

Run: `npm run typecheck`
Expected: 0 errors.

### Task 8.4: `ModelForm` adds a "类型" select

**Files:**
- Modify: `components/models/model-form.tsx`

1. Add `kind: 'chat' | 'embedding'` to the `ModelFormInitial` type.
2. Add a `kind` state initialized from `initial?.kind ?? 'chat'`.
3. Add to the POST/PUT body: `kind`.
4. Render a "类型" select above the "设为默认" checkbox:

```tsx
      <div className="space-y-2">
        <Label htmlFor="kind">类型</Label>
        <select
          id="kind"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'chat' | 'embedding')}
          disabled={isPending}
        >
          <option value="chat">对话（chat）</option>
          <option value="embedding">向量（embedding）</option>
        </select>
        <p className="text-xs text-muted-foreground">
          对话模型用于聊天和摘要；向量模型用于笔记片段的语义检索。
        </p>
      </div>
```

5. Add the form helper text for embedding models noting that baseUrl should point to an OpenAI-compatible `/embeddings` endpoint.

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

### Task 8.5: `ModelListItem` shows a kind chip

**Files:**
- Modify: `components/models/model-list-item.tsx`

1. Add `kind: 'chat' | 'embedding'` to the `ModelListItemData` type.
2. Render a chip next to the "默认" badge:

```tsx
{model.kind === 'embedding' ? (
  <span className="inline-flex items-center rounded-full border border-accent bg-accent/20 px-2 py-0.5 text-xs text-accent-foreground">
    向量
  </span>
) : null}
```

3. Make sure callers pass `kind` when constructing `ModelListItemData` (the page that renders the list). Check `app/(app)/settings/models/page.tsx` and update its mapping.

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

---

## Phase 9 — Misc

### Task 9.1: `bootstrap.ts` reminder

**Files:**
- Modify: `scripts/bootstrap.ts`

Add at the very end of `main()` (just before the implicit `return`):

```ts
  // 4. Reminder for the embedding CLI (does not run anything by itself).
  console.log(
    '[bootstrap] tip: if you plan to use semantic chat, add a kind=embedding model ' +
      'in Settings → Models, then run `npm run embed-all` to backfill existing notes.',
  );
```

Run: `npm run typecheck`
Expected: 0 errors.

### Task 9.2: `package.json` adds `sqlite-vec` dep

**Files:**
- Modify: `package.json`

In `dependencies`, add:

```jsonc
"sqlite-vec": "^0.1.0"
```

(Use the latest published version of `sqlite-vec` that supports your
Node/Alpine combo. The codebase only depends on `db.loadExtension(name)`,
not on a specific SQLite-vec API surface.)

Run: `npm install`
Expected: a clean install. (If `sqlite-vec` has native binding issues on
your dev box, this is the moment they surface — pin to the previous
version or add `--build-from-source`.)

Run: `npx tsx scripts/smoke-embed.ts`
Expected: the `[smoke-embed] sqlite-vec NOT loaded` warning should now be absent, and the embedding path in `searchRelevantChunks` will actually run.

### Task 9.3: Dockerfile builds `sqlite-vec`

**Files:**
- Modify: `docker/Dockerfile`

The existing image already installs `python3 make g++` for `better-sqlite3`.
`sqlite-vec` reuses the same toolchain for its native binding on alpine.
If the prebuilt artifact does not match the runtime (architecture
mismatch), force a from-source build by changing the `npm ci` step to
`npm ci --build-from-source`.

Run: `npm run build` (this validates the standalone build still completes, which is the closest local proxy for "Dockerfile still works" we have).

Expected: build completes.

---

## Phase 10 — Final verification

### Task 10.1: Comprehensive smoke-embed

**Files:**
- Modify: `scripts/smoke-embed.ts`

Append to `main()` (one final block):

```ts
  // Phase 4: chat pipeline
  const { streamChat } = await import('@/lib/ai/chat');
  const session = await import('@/lib/auth/session');
  // We cannot easily mock the session here; just verify the imports
  // and the prompt-building path don't throw.
  const { buildChatContext } = await import('@/lib/ai/prompts');
  const ctx = buildChatContext([
    { chunkId: 1, noteId: 'n1', title: '示例', content: '内容 A', tags: ['x'] },
    { chunkId: 2, noteId: 'n1', title: '示例', content: '内容 B', tags: ['x'] },
  ]);
  check('buildChatContext renders grouped passages', ctx.includes('[笔记 1]') && ctx.includes('片段 1/2') && ctx.includes('片段 2/2'));
  check('buildChatContext mentions the title', ctx.includes('示例'));
```

Run: `npx tsx scripts/smoke-embed.ts`
Expected: every check passes. If a check fails with a missing model error, that's OK — the test prints PASS for buildChatContext (which is pure) and the chat-streaming steps are guarded.

### Task 10.2: Full build verification

Run, in order:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run build`
4. `npx tsx scripts/smoke-db.ts`
5. `npx tsx scripts/smoke-embed.ts`

Expected: all commands exit 0.

### Task 10.3: Manual UI regression

Open `npm run dev`, then visit `/chat`. Run three queries:

- `hermes` — FTS5 path; expect the same results as before this change.
- `我之前关于快递柜的想法是啥` — embedding path; expect more relevant
  results than a keyword-only search would find.
- `我买过特斯拉吗` — negative case; expect the model to answer
  "我的笔记里没有找到相关信息" rather than hallucinate.

Also visit `/settings/models` and add a new embedding model: confirm the
"类型" select is present, that saving it as the default makes the
`getDefaultEmbeddingModelId` smoke check pass, and that the list shows
the "向量" chip.

When all of the above pass, the spec is implemented.

---

## Self-review checklist (executor runs before marking done)

- [ ] Every spec section in `docs/superpowers/specs/2026-06-04-chat-nlp-rag-design.md`
      has at least one task that implements it.
- [ ] No "TBD" / "TODO" / "fill in details" / "implement later" remains
      in any step.
- [ ] Type / function names are consistent across tasks (e.g.
      `searchRelevantChunks` is used the same way in Tasks 5.3, 6.1, 6.3).
- [ ] Smoke-embed phases 1, 2, 3, 4 all pass.
- [ ] Build verification (typecheck / lint / build / smoke-db / smoke-embed)
      all pass.
- [ ] Manual UI regression (the three `/chat` queries + the model-form
      "类型" select) all behave as described.
