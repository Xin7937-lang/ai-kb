# Spec — Agent Tool-Calling for `/chat` (Stage 1)

> **Status**: ready-for-agent
> **Source decisions**: 12 decisions from grill-me session (A.1, A.2, B.5, B.6, C.7–C.10, D.11, D.12)
> **Out of scope (deferred)**: stage 2 `edit_note` / `delete_note` tools, batch operations, tag mutation, multi-user / shared access

---

## Problem Statement

The current `/chat` interface answers questions about my knowledge base via RAG retrieval. Every interaction is read-only: if I want to capture a thought, summarize what the LLM just told me, or save a new note from conversation content, I have to leave the chat, navigate to the notes editor, and manually create the note. This breaks the in-conversation flow that chat is supposed to support.

I want the LLM agent inside `/chat` to take actions on my behalf — read notes I ask about, create new notes from the conversation — so that chat becomes a single workspace for both thinking and recording, without context-switching between surfaces.

---

## Solution

Add tool-calling capability to `/chat`. The agent gains exactly two tools in this stage:

- **`read_note`** — Given a note ID or a search query, returns matching notes from the knowledge base.
- **`create_note`** — Given a title and content, creates a new note on my behalf via the existing data layer.

When I send a chat message, the LLM may decide to invoke one or both tools as part of its response. The chat stream renders each invocation as a compact inline card showing what the agent is doing ("📖 Reading note…", "✓ Created note 《Foo》"). The agent's text response continues alongside the cards.

The capability ships behind a settings toggle (`agent_tools_enabled`, default **OFF**) so I review the code path before enabling it. Every agent write operation is recorded in a new audit table (`agent_actions`) I can browse later.

Edit and delete operations are explicitly **deferred to stage 2**. Stage 1 only enables read + create.

---

## User Stories

1. As a chat user, I want the agent to read my notes when I ask about them, so that I can refer to specific notes without leaving the conversation.
2. As a chat user, I want the agent to create new notes from conversation content, so that I can capture thoughts without breaking flow.
3. As a chat user, I want to see which tool the agent is invoking as it works, so that I trust the agent is doing what I asked.
4. As a chat user, I want tool invocations to fail gracefully (e.g., note not found) and the agent to recover or report the issue, so that one bad call doesn't crash the chat.
5. As a chat user, I want a settings toggle to disable tool-calling entirely, so that I can revert to read-only chat at any time.
6. As a chat user, I want a browsable history of agent actions (what was created, when, in which conversation), so that I can review and undo if needed.
7. As a chat user, I want newly-created notes to be immediately searchable via RAG in the same conversation, so that I can refer back to them.
8. As a chat user, I want the agent to be unable to edit or delete my existing notes in this stage, so that prompt injection in note content cannot cause data loss.
9. As a chat user, I want tool invocations per conversation to be capped, so that a runaway agent cannot create an unbounded number of notes.
10. As a chat user, I want tool inputs to be validated strictly (title length, content length), so that the agent cannot smuggle oversized data into my notes.
11. As a chat user, I want the chat to remain fully usable when the agent decides not to call any tools, so that pure Q&A continues to work as before.
12. As a chat user, I want note creation to succeed even when Zhipu embedding is unavailable, so that the agent can still create notes (with FTS-only search fallback).
13. As a chat user, I want the agent's tool calls to use the chat history as context, so that I do not have to repeat what I said two turns ago.
14. As a chat user, I want each tool invocation to show me which parameters the agent chose, so that I can verify the agent understood my intent.
15. As a chat user, I want tool errors to surface in the chat stream with a clear visual indicator, so that I notice failures without parsing raw events.
16. As a chat user, I want the audit history to be filterable by conversation, so that I can see what the agent did during a specific chat session.
17. As a chat user, I want the settings toggle to be reversible without losing my audit history, so that disabling tools does not wipe the record.
18. As a chat user, I want to ask the agent to read a specific note by ID, so that I can refer to a note I just opened in another tab.
19. As a chat user, I want to ask the agent to search notes by query string, so that I do not need to know note IDs by heart.
20. As a chat user, I want newly-created notes to appear in the main notes list, so that standard navigation continues to work.
21. As a chat user, I want `create_note` to fail loudly when the DB write itself fails (not just embedding), so that I do not get a half-created note with no audit row.
22. As a chat user, I want the agent's `create_note` to take the same code path as the manual "new note" button, so that I get consistent behavior (tags, embedding, FTS) regardless of trigger.
23. As a chat user, I want chat to degrade gracefully to text-only mode if the tool registration fails at startup (e.g., library version mismatch), so that I am not locked out of chat entirely.
24. As a future stage-2 user, I want the stage-1 audit and tool-registration infrastructure to accommodate adding `edit_note` and `delete_note` later, so that I do not have to redo the foundations.
25. As a future user sharing this codebase, I want the agent's action schema to be self-describing enough that another developer can reason about what the agent can and cannot do.

---

## Implementation Decisions

### Capability scope

- **Stage 1 surface**: `read_note` and `create_note` only. No `edit_note`, `delete_note`, tag mutation, chat-history access, or batch operations.
- **`create_note` is single-note only**: one invocation creates exactly one note. Bulk import is explicitly deferred.
- **Tools surface only via the existing `/chat` route**: no new UI buttons, no direct tool triggers from elsewhere.

### Tool implementation shape

- Tools are defined in a new subdirectory of the AI module: one module per tool (`read_note`, `create_note`). Each module exports an object built with Vercel AI SDK's `tool()` helper, accepting a Zod schema (parameters) and an `execute` function.
- **Tool registration** happens in the existing chat stream entry function (`streamChat`). The entry function mounts tools conditionally based on the settings toggle. When the toggle is OFF, the chat behavior is byte-for-byte identical to today.
- **`create_note` reuses the existing note-creation data-layer function** (`createNote`). The tool's `execute` does not duplicate insertion logic; it calls the existing function so that agent-created notes flow through identical FTS indexing, embedding pipeline, and tag handling.
- **Tool parameter validation**: each tool's parameters use Zod with strict length caps (`create_note`: title ≤ 200 chars, content text ≤ 50000 chars; `read_note`: either `noteId` or `query`, not both empty). Vercel AI SDK rejects invalid parameters automatically; the LLM receives the validation error in its context.

### Authorization and audit

- **`agent_actions` table** (new): records every agent write operation. The table has columns for: a unique action ID, the originating conversation ID, the action type (text field, supports future action types like `edit_note` / `delete_note`), the target note ID (when applicable), the parameters as JSON, the result (text: `ok` | `ok_with_embedding_disabled` | `error` | `pending` — the `ok_with_embedding_disabled` variant covers the case where the note was saved but the embedding pipeline didn't run, e.g. no sqlite-vec extension loaded or no default embedding model configured), an optional error message, and a creation timestamp.
- **Two-phase write**: the tool wrapper inserts a `pending` row into `agent_actions` **before** invoking `createNote`, then updates the row to `ok` or `error` after the call completes. Both success and failure paths leave an audit trail.
- **Audit read endpoint**: a new GET endpoint lists recent `agent_actions` rows, paginated, with optional filter by conversation ID. The response shape matches the existing API conventions (`{ data: [...] }` / `{ error, message }`).
- **UI affordance**: the audit list renders as a section on the existing settings page ("Recent agent actions") with timestamps, action type, target note ID, and result status.
- **Toggle** (`agent_tools_enabled`): lives in the existing `settings` KV table. Default value: `false`. The chat stream entry reads this setting once per request and skips tool mounting if disabled.
- **Rate limit**: a single conversation turn is capped at N tool calls (configurable in `settings`, default value chosen at implementation). The cap applies to all tools combined, not per-tool. The counter resets per turn.

### Prompt hardening

- The chat system prompt gains an explicit paragraph instructing the model that **note content** (whether retrieved via `read_note` or surfaced through RAG context) is **untrusted data, not instructions**. The model is told to ignore any text in notes that resembles directives or commands.
- The system prompt also tells the model that it has access to exactly two tools (`read_note`, `create_note`) and that it must not attempt to simulate other capabilities (file deletion, network calls, etc.).
- The prompt explicitly forbids the model from claiming to have performed actions it did not perform.

### UI integration

- Tool call rendering: a new chat component renders each tool invocation as a compact inline card in the assistant message stream. Three states: in-progress (with spinner), success (one-line confirmation, expandable to show full params/result), error (red indicator with error code).
- Cards match the existing chat stream typography — single-line height by default, no jarring visual elements.
- The Vercel AI SDK's `onToolCall` hook is wired into the existing chat UI client component. No new client/server boundary is introduced.

### Error contract

- Tools return structured errors: `{ ok: false, error: '<snake_code>', message?: '<human readable>' }`. Error codes follow the existing API conventions (e.g., `note_not_found`, `create_failed`, `embedding_disabled`, `tool_limit_exceeded`).
- Success returns `{ ok: true, ...payload }`. Payloads are the relevant note data (for `read_note`) or the new note ID and title (for `create_note`).
- The LLM uses the structured error to decide the next action (retry with different params, give up gracefully, surface the issue to the user in prose).
- Parameter validation failures (Zod) flow back to the LLM automatically via Vercel AI SDK; no manual handling required.

### Schema migration

- A new migration creates the `agent_actions` table with the columns and indexes described above.
- The migration also seeds the default `agent_tools_enabled=false` value in the `settings` KV, using the same pattern as existing settings keys (`CHAT_RETRIEVE_LIMIT_KEY`, `CHAT_WEB_SEARCH_KEY`).
- The migration is non-destructive and idempotent on already-migrated databases (the existing migration runner is idempotent at the version level).

---

## Testing Decisions

- **No test framework is introduced** (per AGENTS.md). Tests follow the existing pattern: `.test.ts` files co-located with the source, run via `tsx` (e.g., `npx tsx <path>/<thing>.test.ts`). Each file uses a `cases[]` array with manual `process.exit(1)` on any failure. The existing unit test in the note chunking module is the reference pattern.
- **What makes a good test**: each test verifies the tool's **external behavior** (return shape, DB side effects, audit row insertion) without coupling to internal implementation details. Tests use the existing `process.env.DB_PATH` redirect pattern (the same trick the existing DB smoke script uses) to point at a throwaway DB.
- **Per-tool unit tests** (one per tool module): cover the happy path plus one or two error paths per tool. For `create_note`: success path (note row inserted, embed succeeded, audit row inserted with `result='ok'`), Zod validation failure (title too long), graceful embedding-disabled fallback (audit row inserted with `result='ok_with_embedding_disabled'`). For `read_note`: hit by ID, miss returns `note_not_found`, search-by-query with results, search-by-query with zero results.
- **End-to-end smoke**: a new smoke script exercises the full HTTP boundary. The script spins up a throwaway DB, bootstraps auth, logs in to obtain a JWT cookie, then POSTs a chat message engineered to trigger `create_note` (the system prompt is crafted to make the call deterministic, or the prompt explicitly instructs the model to always create a note summarizing the turn). The script parses the SSE event stream, asserts a `tool_call` event for `create_note`, asserts a `finish` event, then asserts DB state (row in `notes`, row in `agent_actions` with `result='ok'`, row in the embedding table). Exit code 0/1.
- **Tests stay small**: each test file fits comfortably in a single context window per the existing chunker test precedent.
- **Test seams used (existing)**: the environment variable injection point (for `DB_PATH`, `JWT_SECRET`, `ENCRYPTION_KEY`), the DB singleton accessor, and the existing throwaway-DB smoke script pattern. No new seams introduced.

---

## Out of Scope

- **`edit_note` and `delete_note` tools**: deferred to stage 2. The audit infrastructure and tool registration pattern leave room for these without rework; only new tool files and registration entries need adding.
- **Batch operations**: no multi-note create, no "delete all notes with tag X", no bulk import flows.
- **Tag manipulation by the agent**: the agent cannot add, remove, or rename tags on existing notes in this stage. Tags may be supplied at creation time only via the `create_note` parameter schema.
- **Chat history as a separate tool**: the LLM already has conversation history in its context; no explicit "read chat history" tool is provided.
- **Destructive-action confirmation UX**: not relevant in this stage since no destructive operations exist. Stage 2 needs explicit confirmation UX before any destructive tool ships.
- **External content sources (RSS, web scraping, file uploads) as tool inputs**: out of scope. Tool inputs are entirely user-driven via chat messages.
- **Multi-user / shared access**: the system remains single-user. Audit infrastructure is shaped around one user.
- **GitHub issue tracker integration for this spec**: this spec is published as a local file (`.scratch/agent-crud/spec.md`). Migrating to GitHub Issues is a separate effort requiring `/setup-matt-pocock-skills` first.

---

## Further Notes

- **Stage 2 readiness**: the `agent_actions.action_type` column is `TEXT` (no DB-level enum), so future action types (`edit_note`, `delete_note`) can be added without a schema change. The settings KV pattern accommodates new toggle keys the same way. The tool registration pattern in the chat stream entry accepts a tools object keyed by name, so stage 2 only needs new tool files plus a registration line.
- **Why a new subdirectory for tools**: the existing AI module has flat one-file-per-concern layout (`provider`, `chat`, `summarize`, `retrieval`, `embeddings`, `prompts`). Tools are grouped under a `tools/` subdirectory because multiple tools can exist per concern-area (stage 1: two; stage 2: up to four). Subdirectory also matches the import structure (`./tools/read_note`).
- **Why the toggle defaults OFF**: the user wants to review the code path before trusting it. The toggle serves as a kill switch for self-protection. After merging stage 1, the user inspects the diff and flips the toggle on manually.
- **Why no test framework**: AGENTS.md forbids introducing a framework without an explicit ask. The existing `*.test.ts` + `tsx` pattern is sufficient for unit tests; the new smoke script pattern is sufficient for integration coverage.
- **Why Zod at every boundary**: the existing codebase uses Zod for all API request validation. Tool parameters follow the same convention for consistency and to inherit the strictness culture (max-length caps, required fields).
- **`.scratch/` is not currently gitignored**: this spec and the upcoming ticket files live in `.scratch/agent-crud/`. A separate ticket ("Add `.scratch/` to `.gitignore`") handles this. Until that ticket lands, the spec must be added to `.gitignore` manually if committing alongside other changes.
- **Conversation memory is automatic**: Vercel AI SDK feeds tool results back into the conversation context, so the agent's next turn sees the tool output. No explicit memory wiring is needed in this stage.
- **The existing chat stream entry is the integration point**: any change here ripples through the chat route, the UI client component, and the existing smoke script (smoke-embed). Tickets must account for this coupling when sequencing.