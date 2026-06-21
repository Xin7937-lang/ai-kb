# Chat Module: Natural-Language RAG

**Date:** 2026-06-04
**Status:** Design approved, awaiting implementation
**Author:** brainstorming session with user

## Goal & scope

Upgrade the `/chat` module from "keyword + FTS5 + multi-signal re-rank" to
"natural-language understanding + hybrid retrieval". The system should grasp
the semantic intent of a user's question (colloquial phrasing, synonyms,
abstract → concrete) and surface the most relevant *passages* (not whole
notes) into the LLM context.

**In scope**

- New chunking → embedding → hybrid retrieval → top-k passages pipeline.
- Embedding generation on the note write path (synchronous, in `createNote`
  / `updateNote`).
- `npm run embed-all` / `embed-missing` CLI to backfill existing notes.
- New `note_chunks` table and `note_chunks_vec` sqlite-vec virtual table
  (migration v3).
- `model_configs.kind` column so the same model-config UI can carry chat
  and embedding models side by side.

**Out of scope**

- Cross-note summarization, cross-passage synthesis.
- Changes to the home page / global search (they keep using FTS5).
- Background job queue / retry worker.
- SSE / UI / auth / model-management UI redesign.
- Fragment-level deep links (Sources still jump to the whole note).

## Data model (migration v3)

Two new objects and one new index. All new tables live alongside the existing
`notes` / `notes_fts` / `tags` / `note_tags` / `assets` / `model_configs` /
`settings` / `_migrations` tables.

```sql
-- Passage / chunk of a note
CREATE TABLE note_chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- sqlite-vec requires INTEGER rowid
  note_id     TEXT    NOT NULL,
  chunk_index INTEGER NOT NULL,                   -- 0..N-1, in document order
  content     TEXT    NOT NULL,
  start_pos   INTEGER NOT NULL,                   -- offset into notes.content_text
  end_pos     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  UNIQUE (note_id, chunk_index)
);
CREATE INDEX idx_note_chunks_note_id ON note_chunks(note_id);

-- Vector index (sqlite-vec vec0). Dimension is fixed at 1024 to match
-- Qwen text-embedding-v3. Bumping the dimension requires a migration that
-- re-embeds every row.
CREATE VIRTUAL TABLE note_chunks_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,                   -- = note_chunks.id
  embedding float[1024]
);

-- model_configs: add a kind column. Existing rows default to 'chat'.
ALTER TABLE model_configs ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
CREATE INDEX idx_model_configs_kind ON model_configs(kind);
```

Notes:

- `note_chunks_vec.chunk_id` references `note_chunks.id` (not `note_id`).
  This keeps the vec0 schema simple and lets us use the cascade FK on
  `note_chunks` to clean chunks; the vec rows for those chunks are deleted
  by a small follow-up SQL when a note is removed (sqlite-vec supports
  `DELETE FROM vec_table WHERE chunk_id IN (...)`).
- `start_pos` / `end_pos` are stored for future fragment-highlighting
  work; this spec does not use them.
- Migration v3 does **not** embed any existing data — backfill is a
  separate CLI step.

## Chunking

A pure function `chunkNote(content: string): Chunk[]` in `lib/notes/chunk.ts`.

Algorithm:

1. Hard-split on double newlines, Markdown headings (`#` / `##` / `###`),
   list items, and table rows — preserve those boundaries.
2. A segment ≤ 800 chars becomes a chunk as-is.
3. A segment > 800 chars: soft-split on sentence terminators
   (。！？.!? + newline), accumulating ~800 chars per cut. Never split
   inside a sentence.
4. Adjacent chunks share a ~100-char sliding window of overlap.
5. Empty `content` → empty array. `content.length < 100` → single chunk
   that is the whole content.

**Why these numbers.** Qwen text-embedding-v3 has an 8k token context;
800 Chinese chars ≈ 400 tokens leaves room for the system prompt. Top-5
chunks × 800 chars ≈ 2k tokens in the prompt — comfortable.

Chunk content is stored verbatim. Note title is **not** duplicated into
chunks; it is prepended per-passage in the LLM context block.

## Embedding write path

**Where it runs.** Synchronously inside `createNote` and `updateNote`
(in `lib/notes/queries.ts`), immediately after the `notes` row is
written.

**Transaction boundary.** Embedding API calls involve external HTTP and
must not live inside a `tx()`:

1. `tx { INSERT notes, INSERT note_tags }` (existing logic, unchanged).
2. *Outside* the transaction: clear old chunks for the note, compute
   new chunks, call the embedding API per chunk, write `note_chunks` +
   `note_chunks_vec`.
3. If step 2 fails partway: `console.error` the error, **leave the note
   saved**. The note will simply have zero chunks. It still appears in
   FTS5 results; only the embedding path skips it. Run `embed-missing`
   to backfill.

There is no `embedding_backlog` table in v1 — backfill relies on the
`note_id NOT IN (SELECT note_id FROM note_chunks)` query in the CLI.
This is the deliberate simplification: single writer, low failure rate,
`embed-missing` is the catch-up.

**Embedding client.** A new module `lib/ai/embeddings.ts`:

- `getDefaultEmbeddingModelId()` mirrors `getDefaultModelId()` in
  `provider.ts` but filters `model_configs.kind = 'embedding'`.
- `embedTexts(texts: string[]): Promise<number[][]>` returns one
  1024-dim vector per input.
- Implementation: try the Vercel AI SDK path first
  (`openai.textEmbeddingModel(modelId)`); fall back to a hand-rolled
  `fetch(baseURL + '/embeddings', ...)` if the SDK does not support
  custom-baseURL embeddings cleanly on 3.4.7.

## Hybrid retrieval

`lib/ai/retrieval.ts` gains a new function `searchRelevantChunks(question,
k = 5)` that returns:

```ts
type RetrievedChunk = {
  chunkId: number;
  noteId: string;
  title: string;
  content: string;       // chunk text
  tags: string[];
  score: number;         // rrf_score
  paths: Array<'fts' | 'embedding'>;  // which paths contributed
};
```

Pipeline:

1. **Path A — FTS5.** Reuse the existing `buildFtsOrQuery` +
   `extractSearchTerms` + stop-word list. Retrieve up to 20 candidate
   chunks (note: switch from note-level to chunk-level FTS if needed; if
   we keep the FTS over `notes` and then join to chunks, we filter the
   candidate chunk set to "first chunk of each note" or use the full
   chunk count — see the *FTS granularity* callout below).
2. **Path B — Embedding.** Embed the question; run a sqlite-vec KNN
   query: `SELECT chunk_id, distance FROM note_chunks_vec WHERE embedding
   MATCH ? ORDER BY distance LIMIT 20`. Convert to score
   `1 / (1 + distance)`.
3. **RRF fusion.** For each candidate that appears in either path:
   `rrf = 1 / (60 + rank_A) + 1 / (60 + rank_B)` where missing ranks
   contribute 0. Sort by `rrf` desc.
4. **Dedupe + diversity.** Same `note_id` may not occupy more than 2 of
   the top `k` slots. Trim to `k`.
5. **Materialize.** Join `note_chunks` for `content` and the source
   `notes` row for `title` + `tags`.

**FTS granularity callout.** The existing `notes_fts` indexes whole
notes, not chunks. Two acceptable approaches:

- **(A)** Keep `notes_fts` as-is; when a note matches, include up to 2 of
  its chunks (e.g. the first 2, or the 2 with the most keyword overlap).
  This is cheap and reuses everything.
- **(B)** Build a second FTS5 virtual table over `note_chunks` and route
  path A through it. More precise, more code.

**Decision: A for v1.** If the FTS path keeps surfacing the same chunks
regardless of which one matched, we can promote to (B) in a later
iteration.

## Chat pipeline & prompt

`streamChat` in `lib/ai/chat.ts` is updated in three places:

- Replace the call `searchRelevantNotes(question)` with
  `searchRelevantChunks(question)`.
- Use the new context block from `buildChatContext`.
- Leave SSE encoding, history cap, and error mapping untouched.

`lib/ai/prompts.ts`:

- `CHAT_SYSTEM_PROMPT` is updated to instruct the model to cite as
  `[笔记标题 §片段 N]` and to avoid double-citing the same note.
- `buildChatContext` takes `RetrievedChunk[]` and renders passages with
  per-passage header (`[笔记 1] id=… 标题：… 标签：… 片段 K/M：…`),
  each passage capped at 1500 chars, joined by `\n\n---\n\n`.
- The SSE `sources` event payload gains an optional
  `chunkIndexes: number[]` per source. The client
  (`components/chat/chat-window.tsx`) ignores the new field for now —
  it remains backwards compatible with the existing `{ id, title }`
  shape. The field is included so a future UI iteration can show
  "取自第 N 段" without another server change.

## Error handling & degradation

| Failure                                       | User-visible behavior                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No default chat model (existing)              | 503 `no_default_model` (unchanged)                                                                                                                     |
| **New** No default embedding model            | `console.warn` once; path B skipped; path A (FTS5) still returns results                                                                              |
| Embedding API fails on a query                | `console.warn` per failure; path B skipped for that request                                                                                            |
| Embedding API fails during a write            | `console.error`; chunks for that note not written; note still saved; user can run `embed-missing` later                                                |
| FTS5 returns nothing (existing)               | LIKE fallback (existing)                                                                                                                                |
| sqlite-vec extension fails to load            | `embeddingEnabled = false` global flag set at startup; chat path checks the flag and skips B; a warning is logged on boot; CLI exits with a clear error |
| A single note has `content_text > 50000` chars | `chunkNote` truncates input to 50000 chars before splitting. Defensive guard against one pathological note consuming the embedding budget.             |

**Non-goal:** the chat endpoint must never fail solely because the
embedding path is unhealthy. FTS5 alone is an acceptable degraded answer.

## CLI & backfill

Two new scripts in `package.json`:

```jsonc
"embed-all":     "tsx scripts/embed-all.ts",
"embed-missing": "tsx scripts/embed-all.ts --missing-only"
```

`scripts/embed-all.ts` flow:

1. `getDb()` triggers migration v3 if it has not run.
2. Call `detectEmbeddingEnabled()`. If false, print
   `sqlite-vec extension not loaded — check better-sqlite3 build` and
   exit 1.
3. Call `getDefaultEmbeddingModelId()`. If it throws
   `NoDefaultEmbeddingModelError`, print
   `请先在「设置 → 模型」中添加一个 kind=embedding 的默认模型` and exit 1.
4. Select target notes:
   - `--missing-only`: `notes WHERE id NOT IN (SELECT note_id FROM note_chunks)`.
   - default: every note.
5. For each note (sequential, single worker):
   - Re-run `chunkNote` and the same write path the API uses.
   - Print progress every 10 notes: `embedded 10/123 (8.1%)`.
   - On error: log `id + message`, increment failure counter, continue.
6. Final summary: `成功 N / 失败 M / 耗时 T`.

Re-runs are idempotent: the write path always deletes existing chunks
for the note first.

`scripts/bootstrap.ts` gets one extra line at the end:

> 如果启用了 M3+ embedding 检索，请运行 `npm run embed-all` 初始化。

## Docker

`docker/Dockerfile` already has `python3 make g++` for `better-sqlite3`.
`sqlite-vec` ships prebuilt native bindings for common Node/Alpine
targets; install its npm package (e.g. `sqlite-vec`) alongside
`better-sqlite3` so the binding loads at runtime. If the prebuilt
artifact does not match the runtime (e.g. architecture mismatch), drop
its source into the `python3 make g++` build stage so it is compiled
from source. Verify with `npm run build` that the standalone output
still includes the extension loader. `.dockerignore` does not need
changes.

## Testing & verification

No unit-test framework is added (per `AGENTS.md` "do not introduce
jest/vitest without asking"). A new `scripts/smoke-embed.ts` integrates
the same way as `scripts/smoke-db.ts`:

Coverage:

1. Migration v3 creates `note_chunks` and `note_chunks_vec`.
2. Insert a 5000-char fake note; `chunkNote` returns ≥ 2 chunks.
3. `embedChunks` writes one vec row per chunk.
4. `searchRelevantChunks` returns the right note for both a keyword and
   a paraphrase of the same content.
5. Updating the note deletes old chunks and writes new ones.
6. Deleting the note removes both `note_chunks` and `note_chunks_vec`
   rows for it.
7. With no default embedding model configured, `searchRelevantChunks`
   still returns FTS5-only results and does not throw.

Manual UI regression (no automation):

- Keyword question: `hermes` (FTS5 path still works).
- Colloquial question: `我之前关于快递柜的想法是啥` (embedding path
  should outperform keyword match).
- Negative question: `我买过特斯拉吗` (must answer "未找到" rather
  than hallucinate).

Build verification order (unchanged from `AGENTS.md`):

1. `npm run typecheck` — 0 errors.
2. `npm run lint`.
3. `npm run build` — standalone build still completes.
4. `npx tsx scripts/smoke-embed.ts` — only when DB / migration /
   crypto / auth / retrieval code changed.

## Rollout

1. Merge the migration + write-path changes. The new code paths are
   no-ops if no embedding model is configured.
2. Update the model-management UI to expose the `kind` field.
3. User adds an embedding model in `设置 → 模型`, sets it as default.
4. User runs `npm run embed-all` once to backfill.
5. Existing `/chat` behavior is unchanged for keyword queries; new
   semantic recall kicks in for everything else.
