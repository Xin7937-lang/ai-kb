// lib/ai/tools/read_note.test.ts
//
// Throwaway integration test for the read_note tool. Mirrors the
// no-test-framework rule (AGENTS.md); cases[] + check pattern.
//
// Run: npx tsx lib/ai/tools/read_note.test.ts
//
// Exits 0 on success, 1 on any failed assertion.

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-rn-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'rn-test';

type Case = {
  name: string;
  check: () => boolean;
};

// Module-scoped captures populated before iteration.
let hitByIdResult: unknown = null;
let missByIdResult: unknown = null;
let queryHitsResult: unknown = null;
let queryEmptyResult: unknown = null;
let schemaAcceptsNoteId: boolean | null = null;
let schemaAcceptsQuery: boolean | null = null;
let schemaAcceptsBoth: boolean | null = null;
let schemaRejectsNeither: boolean | null = null;

async function main(): Promise<void> {
  const { migrate } = await import('../../db/migrate');
  const { getDb, closeDb } = await import('../../db/client');
  const { readNoteTool } = await import('./read_note');

  try {
    migrate();

    // Seed two test notes (FTS5 triggers auto-populate notes_fts).
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO notes
         (id, title, content_json, content_text, summary, summary_state,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run('note-alpha', 'Alpha note', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'database schema design patterns' }] }] }), 'database schema design patterns', now, now);
    db.prepare(
      `INSERT INTO notes
         (id, title, content_json, content_text, summary, summary_state,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run('note-beta', 'Beta note', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unrelated content here' }] }] }), 'unrelated content here', now, now);

    // Schema checks (the parameters field is the Zod schema).
    const params = (readNoteTool as unknown as { parameters: { safeParse: (v: unknown) => { success: boolean } } }).parameters;
    schemaAcceptsNoteId = params.safeParse({ noteId: 'note-alpha' }).success;
    schemaAcceptsQuery = params.safeParse({ query: 'database' }).success;
    schemaAcceptsBoth = params.safeParse({ noteId: 'x', query: 'y' }).success;
    schemaRejectsNeither = params.safeParse({}).success;

    // Execute by noteId (hit + miss)
    hitByIdResult = await readNoteTool.execute({ noteId: 'note-alpha' }, {});
    missByIdResult = await readNoteTool.execute({ noteId: 'does-not-exist' }, {});

    // Execute by query (hits + zero results)
    queryHitsResult = await readNoteTool.execute({ query: 'database' }, {});
    queryEmptyResult = await readNoteTool.execute({ query: 'absolutely nothing matches this xyzzy' }, {});
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'schema accepts {noteId}',
      check: () => schemaAcceptsNoteId === true,
    },
    {
      name: 'schema accepts {query}',
      check: () => schemaAcceptsQuery === true,
    },
    {
      name: 'schema accepts {noteId, query}',
      check: () => schemaAcceptsBoth === true,
    },
    {
      name: 'schema rejects {} (neither noteId nor query)',
      check: () => schemaRejectsNeither === false,
    },
    {
      name: 'execute by noteId hit → {ok: true, note}',
      check: () => {
        const r = hitByIdResult as { ok?: boolean; note?: { id?: string } } | null;
        return (
          r !== null &&
          r.ok === true &&
          r.note !== undefined &&
          r.note.id === 'note-alpha'
        );
      },
    },
    {
      name: 'execute by noteId miss → {ok: false, error: "note_not_found", noteId}',
      check: () => {
        const r = missByIdResult as { ok?: boolean; error?: string; noteId?: string } | null;
        return (
          r !== null &&
          r.ok === false &&
          r.error === 'note_not_found' &&
          r.noteId === 'does-not-exist'
        );
      },
    },
    {
      name: 'execute by query (matches) → {ok: true, results} non-empty',
      check: () => {
        const r = queryHitsResult as { ok?: boolean; results?: Array<{ id?: string }> } | null;
        return (
          r !== null &&
          r.ok === true &&
          Array.isArray(r.results) &&
          r.results.length > 0 &&
          r.results.some((x) => x.id === 'note-alpha')
        );
      },
    },
    {
      name: 'execute by query (no matches) → {ok: true, results: []}',
      check: () => {
        const r = queryEmptyResult as { ok?: boolean; results?: unknown[] } | null;
        return (
          r !== null &&
          r.ok === true &&
          Array.isArray(r.results) &&
          r.results.length === 0
        );
      },
    },
  ];

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
        console.error(`FAIL: ${c.name}`);
        failed++;
      } else {
        console.log(`PASS: ${c.name}`);
      }
    } catch (err) {
      console.error(`ERROR in ${c.name}:`, err);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} tests passed`);
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(1);
});