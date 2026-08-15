// lib/ai/tools/delete_note.test.ts
//
// Throwaway integration test for the delete_note tool. Mirrors the
// no-test-framework rule (AGENTS.md); cases[] + check pattern.
//
// Run: npx tsx lib/ai/tools/delete_note.test.ts

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-del-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'del-test';

type Case = {
  name: string;
  check: () => boolean;
};

let successResult: unknown = null;
let deletedAtAfterSuccess: number | null = null;
let repeatResult: unknown = null;
let nonexistentResult: unknown = null;
let auditAfterDelete: { result: string; target_note_id: string | null; action_type: string } | null =
  null;

async function main(): Promise<void> {
  const { migrate } = await import('../../db/migrate');
  const { getDb, closeDb } = await import('../../db/client');
  const { setAgentToolsEnabled } = await import('../../auth/init');
  const { deleteNoteTool } = await import('./delete_note');

  try {
    migrate();
    setAgentToolsEnabled(true);

    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run('note-live', 'Live note', '{}', 'live content', now, now);
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?, ?)`,
    ).run('note-dead', 'Already deleted', '{}', 'dead content', now, now, now + 1);

    successResult = await deleteNoteTool.execute({ noteId: 'note-live' }, {});
    const t1 = db
      .prepare<[string], { deleted_at: number | null }>('SELECT deleted_at FROM notes WHERE id = ?')
      .get('note-live');
    deletedAtAfterSuccess = t1?.deleted_at ?? null;

    repeatResult = await deleteNoteTool.execute({ noteId: 'note-live' }, {});
    nonexistentResult = await deleteNoteTool.execute({ noteId: 'note-missing' }, {});

    auditAfterDelete =
      db
        .prepare<[], {
          result: string;
          target_note_id: string | null;
          action_type: string;
        }>(
          `SELECT result, target_note_id, action_type FROM agent_actions
            WHERE action_type = 'delete_note'
              AND target_note_id IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get() ?? null;
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'delete on live note returns {ok: true, noteId}',
      check: () =>
        (successResult as { ok?: boolean; noteId?: string })?.ok === true &&
        (successResult as { noteId?: string })?.noteId === 'note-live',
    },
    {
      name: 'delete sets deleted_at on the row',
      check: () =>
        deletedAtAfterSuccess !== null && deletedAtAfterSuccess > 0,
    },
    {
      name: 'delete on already-deleted note returns {ok: false, error: "note_not_found"}',
      check: () =>
        (repeatResult as { ok?: boolean; error?: string })?.ok === false &&
        (repeatResult as { error?: string })?.error === 'note_not_found',
    },
    {
      name: 'delete on nonexistent note returns {ok: false, error: "note_not_found"}',
      check: () =>
        (nonexistentResult as { ok?: boolean; error?: string })?.ok === false &&
        (nonexistentResult as { error?: string })?.error === 'note_not_found',
    },
    {
      name: 'audit row records action_type=delete_note with target_note_id set',
      check: () =>
        auditAfterDelete !== null &&
        auditAfterDelete.action_type === 'delete_note' &&
        auditAfterDelete.target_note_id === 'note-live' &&
        auditAfterDelete.result === 'ok',
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
