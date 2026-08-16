// scripts/smoke-bearer.ts
//
// End-to-end smoke for the LAN-agent Bearer token + contentMarkdown
// changes. Covers three things that the existing unit tests don't:
//
//   1. Middleware bypass on /api/* with an Authorization: Bearer header
//      (uses the same NextRequest shape the Edge runtime sees).
//   2. resolveSessionFromHeaders round-trip with a hash stored in the
//      real SQLite `settings` table.
//   3. Server-side conversion of `contentMarkdown` via markdownToTiptap
//      and insertion through the public createNote() function —
//      proving the route-handler pipeline stores a valid TipTap doc.
//
// We deliberately do NOT stand up a real Next server; that would drag
// in Next's request context and `next/headers` (which only works inside
// a request). Calling the underlying helpers directly covers the same
// surface the HTTP path takes after middleware lets the request
// through. The Edge-side bypass is exercised by `middleware-bearer.test.ts`.
//
// Run: npx tsx scripts/smoke-bearer.ts

import { existsSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path, { resolve } from 'path';

function loadEnvFile(filename: string): void {
  const p = resolve(process.cwd(), filename);
  if (!existsSync(p)) return;
  const raw = readFileSync(p, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// Load env BEFORE any import that transitively pulls in lib/env.ts.
loadEnvFile('.env.local');
loadEnvFile('.env');

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-smoke-bearer-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'smoke-test-password';

type Case = { name: string; check: () => boolean };

let middlewareBearerPass = false;
let middlewareNoAuthReject = false;
let resolveBearerMatch = false;
let resolveBearerMismatch = false;
let markdownConvertedHasHeading = false;
let createdNoteTitle: string | null = null;
let createdNoteContentText: string | null = null;
let createdNoteContentJsonType: string | null = null;
let rawToken: string | null = null;

async function main(): Promise<void> {
  const { migrate } = await import('../lib/db/migrate');
  const { getDb, closeDb } = await import('../lib/db/client');
  const { initAuthFromEnv } = await import('../lib/auth/init');
  const {
    generateAgentApiToken,
    hashAgentApiToken,
    verifyAgentApiToken,
  } = await import('../lib/auth/api-token');
  const { resolveSessionFromHeaders } = await import('../lib/auth/session');
  const { markdownToTiptap } = await import('../lib/notes/markdown');
  const { createNote, getNote } = await import('../lib/notes/queries');
  const { NextRequest } = await import('next/server');
  const { middleware } = await import('../middleware');

  try {
    migrate();
    initAuthFromEnv();

    // ----- 1. Seed an agent token -----
    rawToken = generateAgentApiToken();
    const { setAgentApiTokenHash, getAgentApiTokenHash } = await import(
      '../lib/auth/init'
    );
    setAgentApiTokenHash(hashAgentApiToken(rawToken));

    // ----- 2. Middleware pass-through -----
    const reqBearer = new NextRequest('http://localhost/api/notes', {
      headers: { authorization: `Bearer ${rawToken}` },
    });
    const resBearer = await middleware(reqBearer);
    middlewareBearerPass = resBearer.status !== 401;

    const reqNone = new NextRequest('http://localhost/api/notes');
    const resNone = await middleware(reqNone);
    middlewareNoAuthReject = resNone.status === 401;

    // ----- 3. resolveSessionFromHeaders round-trip -----
    const storedHash = getAgentApiTokenHash();
    const match = await resolveSessionFromHeaders(
      `Bearer ${rawToken}`,
      null,
      storedHash,
    );
    resolveBearerMatch =
      match !== null && (match as { sub: string }).sub === 'agent';

    const wrongToken = generateAgentApiToken();
    const mismatch = await resolveSessionFromHeaders(
      `Bearer ${wrongToken}`,
      null,
      storedHash,
    );
    resolveBearerMismatch = mismatch === null;

    // ----- 4. contentMarkdown conversion + createNote -----
    const md = '# hello\n\nThis is a body line.';
    const converted = markdownToTiptap(md);
    markdownConvertedHasHeading =
      converted.contentJson.type === 'doc' &&
      Array.isArray(converted.contentJson.content) &&
      converted.contentJson.content[0]?.type === 'heading' &&
      converted.contentText.includes('hello');

    const created = await createNote({
      title: 'smoke bearer note',
      contentJson: converted.contentJson,
      contentText: converted.contentText,
      tags: ['smoke'],
    });
    createdNoteTitle = created.title;
    createdNoteContentText = (created as { contentText: string }).contentText;
    createdNoteContentJsonType =
      ((created as { contentJson: { type: string } }).contentJson).type;

    // Sanity: the note is actually in the DB
    const row = getNote(created.id);
    if (!row) throw new Error('created note missing from DB');
  } finally {
    closeDb();
    // Remove the DB plus better-sqlite3 WAL/SHM sidecars.
    for (const p of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      if (existsSync(p)) unlinkSync(p);
    }
  }

  const cases: Case[] = [
    {
      name: 'middleware: /api/notes + valid Bearer → does not return 401',
      check: () => middlewareBearerPass,
    },
    {
      name: 'middleware: /api/notes without auth → returns 401',
      check: () => middlewareNoAuthReject,
    },
    {
      name: 'getSession: matching bearer against stored hash → Session(sub=agent)',
      check: () => resolveBearerMatch,
    },
    {
      name: 'getSession: wrong bearer against stored hash → null',
      check: () => resolveBearerMismatch,
    },
    {
      name: 'markdownToTiptap: converts "# heading" → doc with heading + plain text',
      check: () => markdownConvertedHasHeading,
    },
    {
      name: 'createNote via contentMarkdown pipeline stores the right title',
      check: () => createdNoteTitle === 'smoke bearer note',
    },
    {
      name: 'createNote via contentMarkdown pipeline stores derived contentText',
      check: () =>
        typeof createdNoteContentText === 'string' &&
        createdNoteContentText.includes('hello'),
    },
    {
      name: 'createNote via contentMarkdown pipeline stores a TipTap doc',
      check: () => createdNoteContentJsonType === 'doc',
    },
  ];

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
        console.error(`[smoke-bearer] FAIL: ${c.name}`);
        failed++;
      } else {
        console.log(`[smoke-bearer] PASS: ${c.name}`);
      }
    } catch (err) {
      console.error(`[smoke-bearer] ERROR in ${c.name}:`, err);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n[smoke-bearer] ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\n[smoke-bearer] All ${cases.length} tests passed`);
  // Force exit — NextRequest may keep async work alive.
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke-bearer] test runner crashed:', err);
  process.exit(1);
});