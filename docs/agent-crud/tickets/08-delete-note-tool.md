# 08 — delete_note tool

**What to build:** Let the /chat agent soft-delete a note by ID. Soft delete (per stage 2 grill-me) — `deleted_at` is set to the current timestamp; the row stays in the table for audit / restore, but list / get / search all filter it out.

**Blocked by:** 07 (depends on `deleted_at` column + the search-filters)

**Status:** ready-for-agent

- [ ] `lib/ai/tools/delete_note.ts` exports `deleteNoteTool` (Vercel AI SDK `tool()` helper) with a Zod schema: `noteId: string (1..64)`.
- [ ] Soft delete via SQL: `UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`. Returns `{ ok: true, noteId }` on success.
- [ ] Missing `noteId` OR already-deleted `noteId` returns `{ ok: false, error: 'note_not_found', noteId }` (idempotent — same error as a true miss).
- [ ] Tool audits via `withAgentAudit('delete_note', {noteId}, ...)`: `pending` row → `ok` (with `target_note_id` set) on success → `error` with the `note_not_found` message on miss.
- [ ] Soft-deleted notes are invisible to the existing list / get / search (the deleted_at filter was added in ticket 07; this ticket reuses it).
- [ ] `replaceNoteChunks` is NOT called for delete (chunks / embeddings for soft-deleted notes become invisible via the FTS5 query, so we don't need to clear them; defer chunk GC to a future restore-tool ticket if/when added).
- [ ] Unit tests cover: happy path (returns `{ok:true,noteId}` + audit row `ok` with `target_note_id`); missing noteId returns `note_not_found`; idempotent (calling delete twice on the same id returns `note_not_found` on the second call); schema rejects empty noteId.
- [ ] No regression: `smoke-agent` and the existing unit tests still pass.

Spec ref: stage 2 grill-me decisions
Co-Authored-By: Claude <noreply@anthropic.com>