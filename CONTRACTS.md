# Interface Contracts for Parallel Implementation

> **Historical note:** All S1–S10 workstreams are complete, plus RAG-lite chat
> at `/chat` and agent tool-calling (stage 1 + 2: `read_note` / `create_note` /
> `edit_note` / `delete_note`). The file-ownership table below is preserved
> for reference, but new work should check the current file tree rather than
> treating the table as an active gate. Shared conventions (response shapes,
> naming, FTS sanitization, etc.) remain in force.

This document defines shared conventions, function signatures, response shapes,
and historical file ownership boundaries.

## Project layout (current)

```
C:\coding\knowledge-base\
├── app/
│   ├── (auth)/login/{page.tsx, login-form.tsx}
│   ├── (app)/
│   │   ├── chat/{page.tsx, chat-page-client.tsx}    # RAG-lite chat
│   │   ├── notes/{new,[id]}/page.tsx                # CRUD + detail
│   │   ├── settings/
│   │   │   ├── account/page.tsx                     # password change
│   │   │   ├── general/page.tsx                     # app preferences
│   │   │   ├── models/{new,[id]}/page.tsx           # model CRUD
│   │   │   └── tags/page.tsx                        # tag management
│   │   ├── layout.tsx
│   │   └── page.tsx                                 # notes list
│   └── api/
│       ├── auth/{login,logout}/route.ts
│       ├── chat/route.ts                            # SSE streaming
│       ├── export/route.ts
│       ├── import/route.ts
│       ├── models/[id]/{,test}/route.ts
│       ├── notes/[id]/summarize/route.ts
│       ├── settings/route.ts
│       ├── settings/search-providers/route.ts
│       ├── tags/route.ts
│       └── uploads/route.ts
├── components/
│   ├── ui/{button,input,label,card}.tsx             # shadcn
│   ├── chat/chat-window.tsx                         # 'use client'
│   ├── editor/tiptap-{editor,renderer}.tsx
│   ├── notes/                                       # list, filters, view
│   └── models/                                      # forms, list items
├── lib/
│   ├── env.ts, crypto.ts, utils.ts
│   ├── auth/{jwt,password,session,edge,init,constants}.ts
│   ├── db/{client,migrate,migrations}.ts            # now at migration v10
│   ├── notes/{queries,tiptap-init,chunk}.ts
│   ├── ai/{provider,chat,summarize,retrieval,test,prompts,errors,mask,embeddings}.ts
│   ├── search/{config,providers/*.ts,index}.ts      # web search abstraction
│   └── storage/{uploads,archive,mime}.ts
├── middleware.ts
├── next.config.mjs
├── docker/{Dockerfile,.dockerignore}
├── docker-compose.yml
├── scripts/{bootstrap,smoke-db,inspect-notes,smoke-embed,embed-all}.ts
├── docs/{plan-mvp,deploy-synology,deploy-qnap}.md
└── data/, uploads/, backups/                        # gitignored
```

## Database schema (already in place)

```sql
notes         (id TEXT PK, title TEXT, content_json TEXT, content_text TEXT,
               summary TEXT, summary_state TEXT DEFAULT 'none',
               created_at INT, updated_at INT,
               deleted_at INT)                        -- v10: soft-delete; NULL = live
notes_fts     (FTS5 virtual table; kept in sync via triggers)
tags          (id INT PK AI, name TEXT UNIQUE,
               position INT DEFAULT 999999)          -- v2: sort order; 收藏 = 0
note_tags     (note_id TEXT, tag_id INT, PK both, FK CASCADE both)
assets        (id TEXT PK, note_id TEXT?, rel_path TEXT, mime TEXT, size INT,
               created_at INT, FK SET NULL on note delete)
model_configs (id TEXT PK, name TEXT, base_url TEXT, api_key_enc TEXT,
               model TEXT, is_default INT, created_at INT)
agent_actions (id TEXT PK, conversation_id TEXT?, action_type TEXT,
               target_note_id TEXT?, params_json TEXT,
               result TEXT, error_message TEXT?, created_at INT)
settings      (key TEXT PK, value TEXT)
_migrations   (version INT PK, name TEXT, applied_at INT)
```

## Mandatory imports / patterns

### Database access
```ts
import { getDb, tx } from '@/lib/db/client';
// Always use these. Never instantiate a new Database().

const db = getDb();
const row = db.prepare('SELECT ...').get(...);

// For multi-statement work:
tx((db) => {
  db.prepare('...').run();
  db.prepare('...').run();
});
```

### ID generation
```ts
import { nanoid } from 'nanoid';
const id = nanoid(12);  // 12-char URL-safe ID
```

### API route convention
```ts
// app/api/<resource>/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';

export const runtime = 'nodejs';  // required for better-sqlite3

const Body = z.object({ ... });

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // ...
}
```

### Response shape
- Success: `{ data: ... }` or just the resource (be consistent within a resource)
- Error: `{ error: 'code', message?: 'human readable' }`
- HTTP codes: 200 OK, 201 Created, 400 bad body, 401 unauth, 404, 409 conflict, 500

### Server vs client components
- Default: server component (no directive)
- Add `'use client'` only when you need interactivity (state, effects, event handlers)
- TipTap is client-only; wrap it in a client component file

### Tag normalization
- Tags are stored lowercased and trimmed
- UI accepts comma-separated input; split, trim, lowercase, dedupe, filter empty
- A tag row in `tags` table is created on first use
- Migration v2 added `tags.position` (default `999999`); the built-in `收藏` tag is fixed at `position = 0`
- Migration v10 added `notes.deleted_at` (default `NULL`); all public notes accessors filter `WHERE deleted_at IS NULL`

### File paths
- Static assets: relative to UPLOADS_DIR, format `YYYY/MM/<nanoid>.<ext>`
- DB stores `rel_path` (relative to UPLOADS_DIR)
- Public URL: `/uploads/YYYY/MM/<nanoid>.<ext>`
- TipTap file selection and clipboard image paste both POST multipart `file` data to `/api/uploads`; the route requires a session and returns `{ data: { url, assetId } }`. Clipboard paste accepts only the existing PNG/JPEG/GIF/WebP/SVG allowlist and falls back to normal TipTap paste for other clipboard content.

### shadcn components
- Already available: `Button`, `Input`, `Label`, `Card`
- To add more (Dialog, DropdownMenu, etc.), add the source to `components/ui/` manually
  following the shadcn pattern. Do NOT run `npx shadcn add` (offline-unfriendly).

## File ownership (historical — S1–S10 complete)

| Workstream | May CREATE | May MODIFY | Must NOT touch |
|---|---|---|---|
| **S4** notes CRUD | `app/api/notes/**`, `app/api/tags/**`, `app/(app)/notes/**`, `components/notes/**`, `components/editor/**`, `lib/notes/**` | `app/(app)/layout.tsx` (add sidebar), `app/(app)/page.tsx` (replace with notes list) | `lib/auth/*`, `lib/db/*`, `lib/ai/*`, `lib/crypto.ts`, `middleware.ts`, `app/api/auth/*`, `app/api/models/*`, `app/api/uploads/*` |
| **S5** image upload | `app/api/uploads/route.ts`, `app/uploads/[...path]/route.ts` (static serve), `lib/storage/uploads.ts`, `components/editor/tiptap-editor.tsx` (file picker + clipboard paste) | — | as above + `lib/notes/*` |
| **S6** import/export | `app/api/import/route.ts`, `app/api/export/route.ts`, `lib/storage/archive.ts`, `lib/notes/markdown.ts` (MD→TipTap conversion) | — | as above |
| **S7** model mgmt | `app/api/models/**`, `app/(app)/settings/**`, `components/models/**`, `lib/ai/provider.ts`, `lib/ai/test.ts` | — (sidebar link added by S4 already) | `lib/auth/*`, `lib/db/*`, `lib/crypto.ts`, `app/api/notes/*`, `app/api/uploads/*` |
| **S8** AI summary | `app/api/notes/[id]/summarize/route.ts`, `lib/ai/summarize.ts`, `lib/ai/prompts.ts` | `components/notes/note-view.tsx` (add summary button) — but only if S4 created it; otherwise create the component | as above |
| **S9** Docker | `docker/Dockerfile`, `docker/.dockerignore`, `docker-compose.yml` | — | everything in `app/`, `components/`, `lib/` |
| **S10** deploy doc | `docs/deploy-synology.md` | — | everything else |

## Naming conventions
- Tables: snake_case, plural (`notes`, `tags`, `assets`)
- Columns: snake_case
- API URLs: kebab-case plural (`/api/notes`, `/api/model-configs`)
- TS types: PascalCase
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE for env-derived

## Time / dates
- Store as `INTEGER` (Unix ms, `Date.now()`)
- Format for display with `new Date(ts).toLocaleString('zh-CN')`

## FTS behavior
- `notes_fts` is auto-updated by triggers; manual sync is unnecessary
- Search query syntax: pass user's `q` to FTS5 MATCH; sanitize to remove chars that break FTS (`"`, `*`, `(`, `)`, `:`) or wrap in double quotes

## API key encryption
- Always: `const enc = encrypt(plaintext);` from `@/lib/crypto`
- Never return `api_key_enc` in responses; only return a mask like `sk-***xxxx`
- Decrypt only inside server-side provider factory (lib/ai/provider.ts)

## Markdown normalization (`contentMarkdown` ↔ TipTap)
- `POST /api/notes` and `PUT /api/notes/:id` accept an optional `contentMarkdown` field in the
  request body. When present, the server converts it via `markdownToTiptap()` in
  `lib/notes/markdown.ts` (uses `marked` → custom HTML tokenizer → TipTap doc) and stores
  the resulting `contentJson` + derived `contentText`.
- Schema rules:
  - `contentJson` and `contentMarkdown` are both optional at the Zod level, but a
    `.refine(...)` requires at least one to be present. `PUT` also requires at least one
    updatable field overall (`title`, `contentJson`, `contentMarkdown`, `contentText`, or `tags`).
  - When both are supplied, `contentMarkdown` wins (a markdown round-trip is more
    predictable than trusting the caller to keep both in sync).
  - `contentMarkdown` is capped at 500_000 characters; larger payloads belong on `POST /api/import`
    (multipart, supports `.md` / `.txt` / `.zip`).
- The `notes.content_json` column always stores a TipTap doc, never raw markdown.
  FTS/embeddings consume `content_text` which is derived server-side.

## Auth: Bearer token (LAN agents)
- `/api/*` routes accept both an `ai_kb_token` cookie (human path) and an
  `Authorization: Bearer <agent_api_token>` header (LAN agent path).
- The Edge middleware (`middleware.ts`) short-circuits on `Authorization: Bearer` for any
  `/api/*` path and hands off to the Node route handler, which calls `getSession()`
  to validate the token against `settings.agent_api_token_hash` (ticket 11).
- Page routes remain cookie-only; bearer headers there do not bypass login.
- The token hash lives in the bind-mounted SQLite DB, so rebuilding the Docker
  image does **not** rotate or clear it. Rotate via `PUT /api/settings/agent-api-token`,
  clear via `DELETE`.

## Standalone build
- `next.config.mjs` already has `output: 'standalone'` and `serverComponentsExternalPackages: ['better-sqlite3']`
- `npm run build` produces `.next/standalone/` with `server.js` ready to run

## Forbidden patterns
- `any` (use `unknown` + narrow)
- Empty catch blocks
- `console.log` in production code (only `console.error` / `console.warn` with prefix)
- Hard-coded paths — use `DB_PATH`, `UPLOADS_DIR`, `BACKUPS_DIR` from env
- Synchronous file I/O on the request path (use `fs/promises`)

## Build verification
After any workstream:
1. `npm run typecheck` — must be 0 errors
2. `npm run build` — must complete cleanly (you may need to write a stub for any imported-from sibling workstream modules that don't exist yet; e.g. S4 should create `lib/notes/queries.ts` exports that S5/S6/S8 will import)
