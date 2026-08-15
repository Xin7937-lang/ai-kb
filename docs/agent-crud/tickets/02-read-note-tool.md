# 02 — read_note tool

**What to build:** The agent can read existing notes by ID or by search query, returning structured results so the agent can incorporate the note content into its response.

**Blocked by:** 01 (shares chat stream entry registration site)

**Status:** ready-for-agent

- [ ] The `read_note` tool module exports a tool object with a Zod schema requiring either a `noteId` or a `query` parameter (refinement: at least one must be non-empty; both allowed but not required)
- [ ] Tool execute with `noteId` returns `{ ok: true, note }` on hit, `{ ok: false, error: 'note_not_found', noteId }` on miss
- [ ] Tool execute with `query` returns `{ ok: true, results: [...] }` for matches (empty array for zero results); results use the existing search-result shape (note summaries, no full bodies, to keep context bounded)
- [ ] Tool is registered in the chat stream entry function alongside `create_note`
- [ ] Unit test covers: hit by ID, miss by ID (returns `note_not_found`), search-by-query with results, search-by-query with zero results
- [ ] Tool schema validation: providing both `noteId` and `query` works without error; providing neither fails Zod refinement with a clear message in the LLM's context
- [ ] No new data-layer code is added — read_note reuses the existing note access functions from the queries module