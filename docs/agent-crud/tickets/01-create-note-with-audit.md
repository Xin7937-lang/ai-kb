# 01 — create_note tool + audit pipeline

**What to build:** With the `agent_tools_enabled` toggle ON, asking the agent to create a note actually creates the note in the database, triggers embedding, and records an audit row. With the toggle OFF, no tools are mounted and chat behaves exactly as today.

**Blocked by:** 00

**Status:** ready-for-agent

- [ ] Schema migration adds the `agent_actions` table with columns for action ID, conversation ID, action type, target note ID, parameters as JSON, result (text), error message, and creation timestamp, plus indexes on conversation_id and created_at
- [ ] Settings KV is seeded with `agent_tools_enabled=false` and `agent_tool_limit=N` defaults, using the same pattern as existing settings keys
- [ ] The chat stream entry function reads the toggle at the start of each request; when OFF or missing, it does not mount any tools
- [ ] The `create_note` tool module exports a tool object built with Vercel AI SDK's helper, accepting title and content parameters via Zod schema with strict length caps (title ≤ 200 chars, content text ≤ 50000 chars)
- [ ] The tool's execute function inserts a `pending` row into `agent_actions` **before** calling the existing `createNote` data-layer function, then updates the row to `ok` or `error` after the call returns — both paths leave an audit trail
- [ ] The tool is registered in the chat stream entry function alongside any other future tools (single registration site)
- [ ] Unit test for the `create_note` tool covers: happy path (note inserted, embed succeeded, audit row inserted with `result='ok'`), Zod validation failure (title too long → LLM gets validation error), embedding-disabled fallback via mock (audit row inserted with `result='ok_with_embedding_disabled'`)
- [ ] Manual verification: with toggle ON, asking the agent to create a note produces a row in `notes`, a row in `agent_actions` with `result='ok'`, and a row in the embedding table; with toggle OFF, no tool registration happens in the chat stream
- [ ] Verification seams used: `process.env.DB_PATH` redirect for the throwaway DB; mock embedder from ticket 00; existing `getDb` singleton