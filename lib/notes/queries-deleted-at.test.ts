// lib/notes/queries-deleted-at.test.ts
//
// Throwaway integration test for the deleted_at filter on
// getNote / listNotes / searchNotesFts. The v10 migration adds
// the column; the ticket 07 acceptance requires every public
// notes accessor to hide rows where deleted_at IS NOT NULL.
//
// Run: npx tsx lib/notes/queries-deleted-at.test.ts

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-softdel-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'softdel-test';

type Case = {
  name: string;
  check: () => boolean;
};

let liveId: string | null = null;
let deletedId: string | null = null;
let liveGetResult: unknown = null;
let deletedGetResult: unknown = null;
let listIds: string[] | null = null;
let searchLiveHit: boolean | null = null;
let searchDeletedHit: boolean | null = null;

async function main(): Promise<void> {
  const { migrate } = await import('../db/migrate');
  const { getDb, closeDb } = await import('../db/client');
  const { getNote, listNotes, searchNotesFts } = await import('./queries');

  try {
    migrate();

    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run('note-live', 'Live note hello world', '{"type":"doc"}', 'hello world', now, now);
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?, ?)`,
    ).run('note-deleted', 'Deleted note hello world', '{"type":"doc"}', 'hello world', now, now, now + 1);
    liveId = 'note-live';
    deletedId = 'note-deleted';

    // getNote
    liveGetResult = getNote('note-live');
    deletedGetResult = getNote('note-deleted');

    // listNotes
    const listed = listNotes({});
    listIds = (listed as { data: Array<{ id: string }> }).data.map((i) => i.id);

    // searchNotesFts (matches "hello world" in both rows)
    const liveHits = searchNotesFts('hello world', { limit: 10 });
    const liveHit = liveHits.find((h) => h.id === 'note-live');
    const deletedHit = liveHits.find((h) => h.id === 'note-deleted');
    searchLiveHit = liveHit !== undefined;
    searchDeletedHit = deletedHit !== undefined;
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'getNote returns the live note',
      check: () => (liveGetResult as { id?: string } | null)?.id === 'note-live',
    },
    {
      name: 'getNote returns null for a soft-deleted note (acts as if missing)',
      check: () => deletedGetResult === null,
    },
    {
      name: 'listNotes excludes soft-deleted notes',
      check: () =>
        listIds !== null &&
        listIds.includes('note-live') &&
        !listIds.includes('note-deleted'),
    },
    {
      name: 'searchNotesFts includes the live note in hits',
      check: () => searchLiveHit === true,
    },
    {
      name: 'searchNotesFts excludes the soft-deleted note from hits',
      check: () => searchDeletedHit === false,
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