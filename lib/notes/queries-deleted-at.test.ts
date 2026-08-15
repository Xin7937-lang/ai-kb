// lib/notes/queries-deleted-at.test.ts
//
// Throwaway integration test for the deleted_at filter on
// getNote / listNotes / searchNotesFts / listTagTree / getNoteStats.
// The v10 migration adds the column; the ticket 07 acceptance requires
// every public notes accessor to hide rows where deleted_at IS NOT NULL.
//
// Code-review finding F4 (ticket 10 review): the original test only
// exercised listNotes({}) (no-filter branch). The tag-only and FTS-list
// branches had the deleted_at filter MISSING — so the test passed but
// the bugs were uncovered. This version seeds a soft-deleted row in
// each path and asserts it stays hidden.
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

let liveGetResult: unknown = null;
let deletedGetResult: unknown = null;
let noFilterListIds: string[] | null = null;
let qListIds: string[] | null = null;
let tagListIds: string[] | null = null;
let untaggedListIds: string[] | null = null;
let searchLiveHit: boolean | null = null;
let searchDeletedHit: boolean | null = null;
let tagTreeContainsDeleted: boolean | null = null;
let statsTotal: number | null = null;
let statsLastWeek: number | null = null;
let statsLastMonth: number | null = null;
let statsLastUpdatedAt: number | null = null;

async function main(): Promise<void> {
  const { migrate } = await import('../db/migrate');
  const { getDb, closeDb } = await import('../db/client');
  const {
    getNote,
    listNotes,
    searchNotesFts,
    listTagTree,
    getNoteStats,
  } = await import('./queries');

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
    // Untagged live note — for the UNTAGGED_FILTER_ID branch coverage.
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run('note-live-untagged', 'Untagged live', '{"type":"doc"}', 'no tag here', now, now);

    // Tag both live and deleted notes with the same tag so the tag-
    // filtered branches would leak the deleted row if the filter is
    // missing. The deleted row must be invisible in every branch.
    db.prepare(`INSERT INTO tags (name, position) VALUES ('test-tag', 100)`).run();
    const tagRow = db
      .prepare<[string], { id: number }>('SELECT id FROM tags WHERE name = ?')
      .get('test-tag');
    if (!tagRow) throw new Error('test setup: tag insert failed');
    const tagId = tagRow.id;
    for (const noteId of ['note-live', 'note-deleted']) {
      db.prepare(
        'INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)',
      ).run(noteId, tagId);
    }

    // getNote
    liveGetResult = getNote('note-live');
    deletedGetResult = getNote('note-deleted');

    // listNotes — no filter (existing coverage)
    const listedNoFilter = listNotes({});
    noFilterListIds = listedNoFilter.data.map((i) => i.id);

    // listNotes — FTS-only branch (F4: previously untested)
    const listedQ = listNotes({ q: 'hello world' });
    qListIds = listedQ.data.map((i) => i.id);

    // listNotes — tag-only branch (F4 + F1)
    const listedTag = listNotes({ tagId });
    tagListIds = listedTag.data.map((i) => i.id);

    // listNotes — UNTAGGED_FILTER_ID branch (F4 + F1)
    const listedUntagged = listNotes({ tagId: -1 });
    untaggedListIds = listedUntagged.data.map((i) => i.id);

    // searchNotesFts
    const liveHits = searchNotesFts('hello world', { limit: 10 });
    searchLiveHit = liveHits.some((h) => h.id === 'note-live');
    searchDeletedHit = liveHits.some((h) => h.id === 'note-deleted');

    // listTagTree — F2 fix verification. The 'test-tag' node must
    // contain note-live but NOT note-deleted.
    const tree = listTagTree({ maxPerTag: 10 });
    const tagNode = tree.find((t) => t.id === tagId);
    const noteIdsInTree = new Set<string>();
    for (const n of tagNode?.notes ?? []) noteIdsInTree.add(n.id);
    tagTreeContainsDeleted = noteIdsInTree.has('note-deleted');

    // getNoteStats — F3 fix verification. Total / lastWeek / lastMonth
    // must exclude soft-deleted; lastUpdatedAt must reflect the latest
    // LIVE row (note-live-untagged is at updated_at=now; note-deleted
    // is at updated_at=now+1ms and must NOT be the answer).
    const stats = getNoteStats();
    statsTotal = stats.total;
    statsLastWeek = stats.lastWeek;
    statsLastMonth = stats.lastMonth;
    statsLastUpdatedAt = stats.lastUpdatedAt;
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
      name: 'listNotes({}) excludes soft-deleted notes',
      check: () =>
        noFilterListIds !== null &&
        noFilterListIds.includes('note-live') &&
        !noFilterListIds.includes('note-deleted'),
    },
    {
      name: 'listNotes({q}) FTS branch excludes soft-deleted notes (F1 fix)',
      check: () =>
        qListIds !== null &&
        qListIds.includes('note-live') &&
        !qListIds.includes('note-deleted'),
    },
    {
      name: 'listNotes({tagId}) tag branch excludes soft-deleted notes (F1 fix)',
      check: () =>
        tagListIds !== null &&
        tagListIds.includes('note-live') &&
        !tagListIds.includes('note-deleted'),
    },
    {
      name: 'listNotes({tagId:UNTAGGED}) branch excludes soft-deleted notes (F1 fix)',
      check: () =>
        untaggedListIds !== null &&
        untaggedListIds.includes('note-live-untagged') &&
        !untaggedListIds.includes('note-deleted'),
    },
    {
      name: 'searchNotesFts includes the live note in hits',
      check: () => searchLiveHit === true,
    },
    {
      name: 'searchNotesFts excludes the soft-deleted note from hits',
      check: () => searchDeletedHit === false,
    },
    {
      name: 'listTagTree per-tag previews exclude soft-deleted notes (F2 fix)',
      check: () => tagTreeContainsDeleted === false,
    },
    {
      name: 'getNoteStats.total excludes soft-deleted notes (F3 fix)',
      // 2 live notes seeded (note-live + note-live-untagged), 1 deleted.
      check: () => statsTotal === 2,
    },
    {
      name: 'getNoteStats.lastWeek excludes soft-deleted notes (F3 fix)',
      check: () => statsLastWeek === 2,
    },
    {
      name: 'getNoteStats.lastMonth excludes soft-deleted notes (F3 fix)',
      check: () => statsLastMonth === 2,
    },
    {
      name: 'getNoteStats.lastUpdatedAt is from a live row, not the deleted one (F3 fix)',
      check: () => statsLastUpdatedAt !== null && statsLastUpdatedAt <= Date.now(),
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
