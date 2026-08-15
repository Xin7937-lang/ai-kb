# AGENTS.md

> Single-user AI personal knowledge base. Next.js 14 (App Router, `output: 'standalone'`) + better-sqlite3 + TipTap + Vercel AI SDK. Runs on Synology NAS via Web Station reverse proxy.

## Read these first — they are the source of truth

The README and CONTRACTS.md describe a workstream plan; **do not trust them for "current state."** All S1–S10 workstreams AND an unannounced M4-style RAG chat are already implemented. Use these for facts:

- **`CONTRACTS.md`** — file ownership, response shapes (`{ data | error }`), naming, FTS sanitization, time storage, Edge vs Node rules. Read before any API route work.
- **`KB-MVP.md`** — product decisions, schema, API surface, env vars, milestone list.
- **`docs/deploy-synology.md`** — step-by-step NAS deploy.
- **`lib/db/migrations.ts`** — actual current schema (now at v10; v2 added `tags.position` + the 收藏 favorites tag, v10 added `notes.deleted_at` for soft-delete).

## Commands

```bash
npm run dev         # dev server (port 3000)
npm run build       # produces .next/standalone/ with server.js
npm run start       # = node server.js (from standalone build)
npm run lint        # next lint
npm run typecheck   # tsc --noEmit — must be 0 errors before merging work
npm run migrate     # = tsx lib/db/migrate.ts (applies schema only)
npm run bootstrap   # = scripts/bootstrap.ts (recommended: migrate + first-run password hash)
```

**No test framework is installed.** `scripts/smoke-db.ts` is a manual integration smoke test (creates throwaway DB, exercises migrations/FTS/crypto). Run with `npx tsx scripts/smoke-db.ts`. Do not introduce jest/vitest without asking.

`scripts/inspect-notes.ts` is a diagnostic — `npx tsx scripts/inspect-notes.ts` dumps notes + image refs.

## Two non-obvious Next.js 14.2.7 workarounds

`next.config.mjs` and `instrumentation.ts` carry workarounds for an upstream Next 14.2.7 + webpack 5 bug. Both are **intentional** — do not "clean up" them.

1. **`instrumentation.ts` is disabled.** `experimental.instrumentationHook` is `false` on purpose. The first-run migration + password hash that would have run there is done by **`npm run bootstrap`** instead. To re-enable, follow the 4 steps at the bottom of `instrumentation.ts` (upgrades to a fixed Next version, or a `node:`-stripping webpack plugin, then flip the flag).
2. **Webpack `node:` URI scheme rewrite.** `next.config.mjs` installs a `NormalModuleReplacementPlugin` that rewrites `node:foo` → `foo`. Same bug. If you see webpack errors about `UnhandledSchemeError` for any `node:` module, this is the symptom, not a config bug.

## Edge vs Node runtime (this will bite you)

- `middleware.ts` runs in **Edge**. It can only import `lib/auth/edge.ts` and `lib/auth/jwt.ts` (and `lib/auth/constants.ts`). Do not import `lib/auth/session.ts` or `lib/env.ts` from middleware — `lib/env.ts` uses `path` which breaks the Edge bundler. `lib/auth/jwt.ts` reads `process.env.JWT_SECRET` directly for the same reason.
- All `/api/*` route handlers that touch SQLite must declare `export const runtime = 'nodejs'` (better-sqlite3 is a native module).
- `app/uploads/[...path]/route.ts` is Node-only and has a manual path-traversal guard (`path.resolve` + prefix check) — read it before changing anything upload-related.

## Database

- **Always** go through `getDb()` / `tx()` from `@/lib/db/client`. Never `new Database(...)`. The singleton stashes itself on `globalThis` to survive Next dev hot-reload.
- WAL mode + `foreign_keys = ON` are set in the client; do not override.
- IDs are `nanoid(12)`. Timestamps are `INTEGER` Unix ms (`Date.now()`).
- `notes_fts` is auto-maintained by triggers; you do not need to manually sync it.
- FTS5 query strings must be sanitized (`"`, `*`, `(`, `)`, `:` break `MATCH`) — see `lib/notes/queries.ts`.
- Tags are stored lowercased + trimmed. The 收藏 tag is special-cased at `position = 0` by migration v2.
- Soft-delete: `notes.deleted_at INTEGER` (NULL = live). Every public notes accessor (`getNote`, `listNotes`, `searchNotesFts`, `listTagTree`, `getNoteStats`) filters out rows where `deleted_at IS NOT NULL`.

## Env vars (all read via `lib/env.ts`)

`JWT_SECRET` and `ENCRYPTION_KEY` must each be **exactly 64 hex chars** (32 bytes). `lib/auth/jwt.ts` and `lib/crypto.ts` both enforce this; `lib/env.ts` throws at module load if either is missing.

`.env.local` in the working dir has placeholder values (`0…0` / `1…1` / `local-dev-password`) and is **functional for dev** but is gitignored. Real deploys need real keys (`openssl rand -hex 32`).

## API route conventions

```ts
export const runtime = 'nodejs';   // required
import { getSession } from '@/lib/auth/session';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // ...
}
```

- Body validation: Zod `.safeParse(...)` → 400 with `issues: parsed.error.flatten()`.
- Response shapes: success `{ data: ... }` (or resource directly for `GET /api/notes` list), error `{ error: 'code', message?: 'human' }`. HTTP codes: 200/201/400/401/404/409/500/503.
- `503` is the code for "no default model configured" (see `/api/chat`).

## shadcn/ui

Six shadcn components exist in `components/ui/`: `button`, `card`, `checkbox`, `input`, `label`, `switch`. **Do not run `npx shadcn add …`** — it is offline-unfriendly in this env. Copy the source manually following the existing pattern; `components.json` (Tailwind slate, CSS variables) is the styling baseline.

## TipTap

`components/editor/tiptap-editor.tsx` is **client-only** (`'use client'`). StarterKit + Placeholder + Image + Table family. The renderer is `components/editor/tiptap-renderer.tsx`. The default empty doc is exported from `lib/notes/tiptap-init.ts` as `EMPTY_TIPTAP_DOC` — reuse it, don't inline.

## AI / chat

- **All models go through the OpenAI-compatible protocol** with `compatibility: 'compatible'` (`lib/ai/provider.ts`). Works for DeepSeek, GLM, StepFun, MiniMax, and any custom endpoint.
- API keys stored AES-256-GCM in `model_configs.api_key_enc` (format: `base64(IV(12) || TAG(16) || CT)`). Never return `api_key_enc` to the client; mask it (`lib/ai/mask.ts`).
- **RAG chat** lives at `/chat` (server page) + `components/chat/chat-window.tsx` (client) + `POST /api/chat` (SSE).
  - Pipeline: hybrid retrieval (FTS5 BM25 + sqlite-vec KNN on 2048d embeddings, fused via RRF) → multi-signal re-rank (recency 14-day half-life × title-hit 2x) → per-note diversity cap (2 chunks max per note) → fold into system prompt → `streamText` (temperature 0.3).
  - History capped at 10 prior user turns (`MAX_HISTORY_USER_TURNS` in `lib/ai/chat.ts`).
  - Optional **web search mode**: setting `chat_web_search_enabled` in DB (`settings/chat-web-search` API) switches the system prompt to allow fallback to model knowledge when notes don't cover the question. Response marked `【基于模型知识 / 网络搜索】` when using non-note sources. Frontend shows amber badge + model-provided source tag.
  - Auto-save in `note-edit-form.tsx`: 30s interval, silent PUT, change-detected via ref comparison. Status indicator ("正在自动保存…" / "已自动保存", 2s auto-dismiss).
- **SSE responses** need Web Station's WebSocket support enabled on the Synology reverse proxy or the browser will buffer forever (see `docs/deploy-synology.md` §5).

## Forbidden patterns (project-enforced)

- `any` — use `unknown` + narrow.
- Empty `catch {}` blocks.
- `console.log` in production code (only `console.error` / `console.warn` with a `[prefix]`).
- Hard-coded paths — use `DB_PATH` / `UPLOADS_DIR` / `BACKUPS_DIR` from `lib/env.ts`.
- Sync `fs` on a request path — use `node:fs/promises`.

## Build verification order

After any non-trivial change, run in this order:

1. `npm run typecheck` (must be 0 errors)
2. `npm run lint`
3. `npm run build` (must complete; the standalone output is what Docker runs)
4. `npx tsx scripts/smoke-db.ts` (only when touching DB / migrations / crypto / auth)

## Directory map (high-signal only)

```
app/                          # App Router. (auth) + (app) groups, /api/* routes
  api/
    chat/route.ts             # SSE streaming chat — hybrid RAG retrieval
    chat/conversations/       # multi-turn conversation persistence CRUD
    chat/conversations/batch-delete/route.ts
    notes/[id]/favorite/route.ts  # toggle 收藏 tag
    notes/[id]/summarize/route.ts
    notes/[id]/tags/route.ts
    notes/batch-tags/route.ts        # batch tag edit on multiple notes
    tags/delete/route.ts
    tags/reorder/route.ts
    settings/app-title/route.ts
    settings/chat-retrieve-limit/route.ts
    settings/chat-web-search/route.ts   # web search toggle PUT
    settings/search-providers/route.ts  # search provider config + key test
  uploads/[...path]/route.ts  # static image serve (Node, public, cache-immutable)
lib/
  env.ts                      # validated, throw-on-missing env access
  crypto.ts                   # AES-256-GCM (key = ENCRYPTION_KEY)
  db/{client,migrate,migrations}.ts   # singleton + migration runner + schema
  auth/{jwt,edge,session,init,password,constants}.ts
  notes/queries.ts            # the public data-access surface for notes/tags
  notes/tiptap-init.ts        # EMPTY_TIPTAP_DOC
  notes/chunk.ts              # text chunker for embedding (800-char, 100-char overlap)
  ai/{provider,chat,summarize,retrieval,test,prompts,errors,mask,embeddings,embeddings-zhipu}.ts
  search/{config,providers/*.ts,index}.ts   # Tavily / Metaso / Bocha web search
  storage/{uploads,archive,mime}.ts
components/
  editor/tiptap-{editor,renderer}.tsx  # 'use client'
  chat/chat-window.tsx                  # 'use client'
  notes/, models/, ui/                  # server + client mix
docker/
  Dockerfile                  # 3-stage node:20-alpine
  .dockerignore               # excludes docs/, .omo/, scripts/smoke-*
docker-compose.yml            # Synology Container Manager — port 127.0.0.1:3000
scripts/
  bootstrap.ts                # migrate + first-run password (preferred over `migrate`)
  smoke-db.ts                 # manual integration test
  inspect-notes.ts            # diagnostic
data/, uploads/, backups/     # gitignored. backups/ is full of manual timestamped .db snapshots
.omo/                         # local agent run-continuation state — do not touch
```

## Deploy (Synology — quick reference; full guide in `docs/deploy-synology.md`)

1. Create `/volume1/docker/ai-kb/{data,uploads,backups}` and put a real `.env` next to them.
2. `docker-compose up -d --build` (or build on dev box, `docker save`/`load` to NAS).
3. `npm run bootstrap` from inside the container (or after first boot) to apply migrations + hash `APP_PASSWORD`.
4. Web Station reverse-proxy → `http://localhost:3000`. **Enable WebSocket** or SSE chat/summarize breaks.
5. First login uses the `APP_PASSWORD` from `.env`; rotate from `/settings/account` afterward.
