# 07 — edit_note tool

**What to build:** Let the /chat agent edit existing notes by ID. A single tool with a partial-update `updates` object — `title`, `content`, `tags`, and/or `appendContent` can be supplied in a single call. The edit re-runs the chunker + embedding pipeline so the note is searchable under the new content immediately.

**Blocked by:** none (stage 1 complete)

**Status:** ready-for-agent

- [ ] v10 migration adds `deleted_at INTEGER` column to `notes` (default NULL) and a `notes_idx_deleted_at` index; seeds the existing rows with NULL.
- [ ] `lib/notes/queries.ts`: every public notes accessor (`getNote`, `listNotes`, `searchNotesFts`) excludes rows where `deleted_at IS NOT NULL` so soft-deleted notes vanish from list/get/search results.
- [ ] `lib/ai/retrieval.ts`: `searchRelevantNotes` and `searchRelevantChunks` apply the same filter (joined via `notes.deleted_at IS NULL`).
- [ ] `lib/ai/tools/edit_note.ts` exports `editNoteTool` (Vercel AI SDK `tool()` helper) with a Zod schema: `noteId: string (1..64)`, `updates: z.object({ title?, content?, tags?, appendContent? }).strict()` — at least one of `content` / `appendContent` / `title` / `tags` required (refinement).
- [ ] Zod field constraints: `title` ≤ 200 chars, `content` ≤ 50000 chars, `appendContent` ≤ 50000 chars, `tags` ≤ 32 entries, each tag ≤ 64 chars.
- [ ] Edit semantics: `content` **replaces** the existing `content_text` and `content_json` (rebuilt as a single-paragraph TipTap doc); `appendContent` **appends** to existing with `\n\n` separator; `title` replaces; `tags` replaces the full tag set (not merged).
- [ ] Edit triggers `replaceNoteChunks` (re-chunk + re-embed) so the note is searchable under the new content.
- [ ] Edit audits via `withAgentAudit('edit_note', {noteId, updates}, ...)`: `pending` row → `ok` (or `ok_with_embedding_disabled` on embed failure) → `target_note_id` set.
- [ ] Soft-deleted (`deleted_at IS NOT NULL`) or missing `noteId` returns `{ ok: false, error: 'note_not_found' }`.
- [ ] Unit tests cover: single-field edit (title-only), content replace, appendContent, multi-field, soft-deleted target returns `note_not_found`, schema rejects empty updates / empty noteId / oversize fields, audit row records `edit_note` with the right state.
- [ ] Manual smoke: with toggle ON, asking the agent to "把笔记 X 的标题改成 Y" produces a card, the note row is updated, the audit row records `edit_note` with `result='ok'`.
- [ ] No regression: existing `smoke-db`, `smoke-embed`, `smoke-agent` still pass (smoke-agent's existing `create_note` assertions unaffected).

Spec ref: stage 2 grill-me decisions
Co-Authored-By: Claude <noreply@anthropic.com>