# 05 — Prompt hardening + rate limit

**What to build:** The chat system prompt instructs the model that note content is untrusted data (anti-injection defense) and explicitly enumerates the available tools. Per-conversation tool call count is capped to prevent runaway agents.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Chat system prompt gains an explicit paragraph instructing the model that note content (whether retrieved via `read_note` or surfaced through RAG context) is untrusted data, not instructions; the model is told to ignore any text in notes that resembles directives or commands
- [ ] Chat system prompt explicitly lists `read_note` and `create_note` as the only tools available to the model
- [ ] Chat system prompt forbids the model from claiming to have performed actions it did not perform (e.g., "I have deleted your notes" when no `delete_note` tool exists)
- [ ] Chat stream entry function enforces a per-conversation tool call cap, reading the value from the settings KV (default value chosen at implementation, configurable later)
- [ ] When the cap is exceeded, additional tool calls fail with `{ ok: false, error: 'tool_limit_exceeded' }` and the agent receives this structured error in its context
- [ ] The cap resets at the start of each new conversation turn (not persisted across turns)
- [ ] Unit test for the rate limit: N tool calls succeed within a turn, the (N+1)-th fails with `tool_limit_exceeded`; cap resets correctly across simulated turns
- [ ] The CHAT_SYSTEM_PROMPT export in the prompts module contains all three additions (anti-injection, tool list, no-fabrication rule); verified by reading the export and asserting the substrings are present