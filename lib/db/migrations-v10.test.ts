// lib/db/migrations-v10.test.ts
//
// Throwaway integration test for the v10 migration (soft-delete
// support). Mirrors the no-test-framework rule (AGENTS.md);
// cases[] + check pattern.
//
// Run: npx tsx lib/db/migrations-v10.test.ts

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-v10-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'v10-test';

type Case = {
  name: string;
  check: () => boolean;
};

let v10Applied: boolean | null = null;
let notesColumnHasDeletedAt: boolean | null = null;
let existingRowsHaveNullDeletedAt: boolean | null = null;
let newRowCanSetDeletedAt: boolean | null = null;
let indexExists: boolean | null = null;

async function main(): Promise<void> {
  const { migrate } = await import('./migrate');
  const { getDb, closeDb } = await import('./client');

  try {
    const result = migrate();
    v10Applied = result.applied.includes(10);

    const db = getDb();

    // Column added?
    const cols = db
      .prepare<[], { name: string }>('PRAGMA table_info(notes)')
      .all();
    notesColumnHasDeletedAt = cols.some((c) => c.name === 'deleted_at');

    // Existing rows (the v9-seeded user/migration rows) should have NULL.
    const sample = db
      .prepare<[], { deleted_at: number | null }>(
        'SELECT deleted_at FROM notes LIMIT 1',
      )
      .get();
    existingRowsHaveNullDeletedAt = sample === undefined ? true : sample.deleted_at === null;

    // Can insert a new row and set deleted_at to a real timestamp.
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?, ?)`,
    ).run('note-soft-delete', 't', '{}', '', 1700000000000, 1700000000000, 1700000000001);
    const newRow = db
      .prepare<[string], { deleted_at: number | null }>(
        'SELECT deleted_at FROM notes WHERE id = ?',
      )
      .get('note-soft-delete');
    newRowCanSetDeletedAt = newRow?.deleted_at === 1700000000001;

    // Index on deleted_at exists.
    const indexes = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notes' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    indexExists = indexes.some((i) => i.name === 'notes_idx_deleted_at');
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'v10 migration was applied',
      check: () => v10Applied === true,
    },
    {
      name: 'notes table has deleted_at column',
      check: () => notesColumnHasDeletedAt === true,
    },
    {
      name: 'existing rows have NULL deleted_at (default)',
      check: () => existingRowsHaveNullDeletedAt === true,
    },
    {
      name: 'new rows can set deleted_at to a real timestamp',
      check: () => newRowCanSetDeletedAt === true,
    },
    {
      name: 'notes_idx_deleted_at index exists',
      check: () => indexExists === true,
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