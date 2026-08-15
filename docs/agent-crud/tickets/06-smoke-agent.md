# 06 — End-to-end smoke (scripts/smoke-agent.ts)

**What to build:** A standalone smoke script exercising the full HTTP boundary: login, chat with tool call, SSE event parsing, DB state assertion. Provides the canonical "did stage 1 work end-to-end" verification for the entire feature.

**Blocked by:** 01, 02, 03, 04, 05

**Status:** ready-for-agent

- [ ] Script spins up a throwaway DB via the existing `process.env.DB_PATH` redirect pattern (same trick the existing DB smoke script uses)
- [ ] Script bootstraps auth (idempotent), logs in to obtain a JWT cookie via the existing login endpoint
- [ ] Script flips `agent_tools_enabled` to ON via the settings endpoint, so tools mount for the chat call
- [ ] Script POSTs to the chat endpoint using a message engineered to trigger `create_note` (the message either picks a model that always creates a note, or instructs the model explicitly to create one summarizing the turn)
- [ ] Script parses the SSE event stream and asserts the presence of a `tool_call` event for `create_note` and a terminal `finish` event
- [ ] Script asserts DB state after the chat completes: a new row in `notes` with the expected title and content, a new row in `agent_actions` with `result='ok'` and matching `target_note_id`, and a new row in the embedding table
- [ ] Script cleans up: closes the DB connection to release the WAL lock, removes the throwaway DB file, exits 0 on full success and 1 on any assertion failure
- [ ] Manual invocation via `npx tsx scripts/smoke-agent.ts` exits cleanly; runs as the canonical pre-merge gate for stage 1
- [ ] The script reuses the existing smoke-DB script's environment-handling pattern (dynamic imports of `lib/db/*` after `process.env` is set, due to tsx import hoisting)
- [ ] No regression: existing `scripts/smoke-db.ts` and `scripts/smoke-embed.ts` continue to work unchanged