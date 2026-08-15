# 09 — CHAT_SYSTEM_PROMPT + buildToolsConfig wire

**What to build:** Wire the two new tools into the system prompt (so the LLM knows about them) and the tools-config builder (so the LLM can call them). Also update the SSE mapper if needed (likely not — edit_note / delete_note use the same `tool-call` / `tool-result` event types).

**Blocked by:** 07, 08 (tools must exist before wiring)

**Status:** ready-for-agent

- [ ] `CHAT_SYSTEM_PROMPT` rule 10 updated: list all four tools (`read_note`, `create_note`, `edit_note`, `delete_note`) and their purposes. Drop the "you don't have delete_note" caveat since now delete_note exists.
- [ ] `CHAT_SYSTEM_PROMPT` rule 11 (no-fabrication) extended to forbid claiming edits or deletes that didn't happen.
- [ ] `buildToolsConfig()` mounts `edit_note` and `delete_note` (still rate-limited via the same `RateLimiter` as stage 1 — `getAgentToolLimit` cap shared across all four tools).
- [ ] The two new tools are wrapped in `withRateLimit` so the same per-turn cap applies; both go through `withAgentAudit` (only `delete_note` is destructive but the audit trail is consistent for all write actions).
- [ ] `prompts.test.ts` updated to assert the new tool names are listed in the prompt and the no-fabrication rule still covers them.
- [ ] `tools-config.test.ts` updated to assert all four tools are present in the config when toggle is on.
- [ ] No regression: existing tests + smoke scripts all still pass.

Spec ref: stage 2 grill-me decisions
Co-Authored-By: Claude <noreply@anthropic.com>