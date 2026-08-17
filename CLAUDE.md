# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** `README.md` describes the workstream plan, not the current state. All S1–S10 workstreams, a RAG-lite chat at `/chat`, and agent tool-calling (stage 1 + 2: `read_note` / `create_note` / `edit_note` / `delete_note`) are already implemented.

## Read first

These are the source of truth — do not duplicate their contents here:

- **`AGENTS.md`** — commands, gotchas, build verification order, forbidden patterns, directory map. Read this before any non-trivial change.
- **`CONTRACTS.md`** — file ownership boundaries, response shapes (`{ data | error }`), naming, FTS sanitization, runtime rules.
- **`KB-MVP.md`** — product decisions, schema, API surface, env vars, milestone list.
- **`docs/deploy-synology.md`** — step-by-step NAS deploy.
- **`docs/agent-crud/spec.md` + `docs/agent-crud/tickets/`** — the agent tool-calling workstream's design decisions and ticket history (stage 1 + 2 both shipped).

## Project

Single-user AI personal knowledge base. Next.js 14 (App Router, `output: 'standalone'`) + better-sqlite3 + TipTap + Vercel AI SDK, served from a Synology NAS via Web Station reverse proxy.

## High-level architecture

- **Auth (Edge + Node split)** — `middleware.ts` runs in Edge and only imports `lib/auth/edge.ts` + `lib/auth/jwt.ts`. Pages and `/api/*` then re-verify with `getSession()` from `lib/auth/session.ts` (Node-side, can hit SQLite). Do not import `lib/env.ts` from middleware — it uses `path` and breaks the Edge bundler.
- **DB layer** — singleton `getDb()` / `tx()` in `lib/db/client.ts`, schema in `lib/db/migrations.ts` (currently v10: initial + tags.position / 收藏 favorite + soft-delete `notes.deleted_at` + `notes_idx_deleted_at` index). `notes_fts` is auto-maintained by triggers. Every public notes accessor (`getNote`, `listNotes`, `searchNotesFts`, `listTagTree`, `getNoteStats`) filters out rows where `deleted_at IS NOT NULL`. IDs are `nanoid(12)`, timestamps are `Date.now()` ms.
- **API surface** — every `/api/*` route that touches SQLite must `export const runtime = 'nodejs'`. Static image serving lives at `app/uploads/[...path]/route.ts` (Node, public, manual path-traversal guard).
- **AI** — all providers go through the OpenAI-compatible protocol via `lib/ai/provider.ts`. API keys AES-256-GCM-encrypted in `model_configs.api_key_enc` (format: `base64(IV(12) || TAG(16) || CT)`). The RAG chat at `/chat` is hybrid retrieval (FTS5 BM25 + sqlite-vec KNN on 2048d embeddings, fused via RRF), with multi-signal re-rank (recency × title-hit) and per-note diversity cap. Optional **web search mode** (`settings/chat-web-search`) lets the model fall back to its own knowledge when notes don't cover the question. SSE routes need WebStation WebSocket support or browsers buffer forever.
- **Agent tools** — `lib/ai/tools/` defines `read_note` / `create_note` / `edit_note` / `delete_note` (Vercel AI SDK `tool()` helpers). Mounted by `buildToolsConfig()` in `lib/ai/tools-config.ts` only when `agent_tools_enabled` setting is true (default off). All write operations go through `withAgentAudit` (`lib/ai/tools/agent-audit.ts`) which records a two-phase `agent_actions` row (pending → ok/error). A per-turn rate limiter (`withRateLimit` + `makeRateLimiter`, cap from `agent_tool_limit` setting, default 5) wraps every tool — the cap is shared across all four tools and resets per `streamChat` invocation. `streamChat` enables `maxToolRoundtrips: 3` so the model can chain create → edit → delete in a single user turn.
- **Editor** — TipTap is client-only (`'use client'`); use `EMPTY_TIPTAP_DOC` from `lib/notes/tiptap-init.ts` rather than inlining. File-selected and clipboard-pasted images share the authenticated `/api/uploads` flow; clipboard handling reads only synchronous paste items and preserves the captured insertion position while the upload runs.
- **shadcn/ui** — six components exist (`button`, `card`, `checkbox`, `input`, `label`, `switch`); `components.json` is the styling baseline. Do not run `npx shadcn add` (offline-unfriendly); copy source manually.

## Environment

`JWT_SECRET` and `ENCRYPTION_KEY` must each be **64 hex chars** (32 bytes). `lib/env.ts` throws at module load if either is missing. `APP_PASSWORD` is optional after first run — the hash lives in `settings.password_hash`. `.env.local` has dev placeholders (`0…0` / `1…1` / `local-dev-password`) and is gitignored.

## Build verification order (after any non-trivial change)

1. `npm run typecheck` — must be 0 errors
2. `npm run lint`
3. `npm run build` — standalone output is what Docker runs
4. `npx tsx scripts/smoke-db.ts` — only when touching DB / migrations / crypto / auth

## Off-limits (intentional)

- `instrumentation.ts` is disabled. Do not flip `experimental.instrumentationHook` to `true` — it triggers a Next 14.2.7 webpack 5 bug. The same bug is why `next.config.mjs` rewrites `node:foo` → `foo` via `NormalModuleReplacementPlugin`. See comments in those files.
- `.omo/` and `.playwright-mcp/` are local agent run-continuation state — do not touch. Both are gitignored at the repo root.
- `.scratch/` is local-only working scratch space (spec drafts, ticket planning notes) — gitignored. If something useful lands there and you want to keep it, move it into `docs/` (tracked) rather than committing `.scratch/` directly.
