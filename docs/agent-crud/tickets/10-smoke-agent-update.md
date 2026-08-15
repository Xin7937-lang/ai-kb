# 10 — smoke-agent stage 2 extension

**What to build:** Extend `scripts/smoke-agent.ts` to also exercise the new edit_note + delete_note tools. Two new prompt + response pairs and additional DB assertions, keeping the single-end-to-end "tool-call dispatched, audit row recorded" pattern.

**Blocked by:** 07, 08, 09 (new tools must be live + prompt must declare them)

**Status:** ready-for-agent

- [ ] The mock fetch returns a tool_call sequence for an `edit_note` invocation (between the create_note and delete_note calls) with `noteId` matching the previously-created note.
- [ ] A subsequent tool_call for `delete_note` against the same `noteId` invokes the delete handler.
- [ ] Mock embedder responds on the embedding endpoint as before.
- [ ] After the run, DB assertions verify:
   - `notes.deleted_at IS NOT NULL` for the soft-deleted note
   - `agent_actions` has rows for `create_note`, `edit_note`, `delete_note` (in that order) — all with `result='ok'` (strict, using the new mock embedder for the embedding path)
   - `target_note_id` matches the created note id across all three rows
- [ ] Reuses the env-first + WAL/SHM cleanup + loadEnvFile pattern from the stage 1 smoke (review-fixed F1-F6).
- [ ] No regression: stage 1 smoke-agent cases still pass; the new cases add to the count.

Spec ref: stage 2 grill-me decisions
Co-Authored-By: Claude <noreply@anthropic.com>