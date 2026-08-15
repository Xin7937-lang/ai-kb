// lib/ai/tools/edit_note.test.ts
//
// Throwaway integration test for the edit_note tool. Mirrors the
// no-test-framework rule (AGENTS.md); cases[] + check pattern.
//
// Run: npx tsx lib/ai/tools/edit_note.test.ts

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-edit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'edit-test';

type Case = {
  name: string;
  check: () => boolean;
};

let titleOnlyResult: unknown = null;
let titleOnlyNewTitle: string | null = null;
let replaceContentResult: unknown = null;
let replaceContentNewText: string | null = null;
let appendContentResult: unknown = null;
let appendContentNewText: string | null = null;
let multiFieldResult: unknown = null;
let multiFieldNewTitle: string | null = null;
let multiFieldNewText: string | null = null;
let nonexistentResult: unknown = null;
let softDeletedResult: unknown = null;
let emptyUpdatesResult: unknown = null;
let auditAfterEdit: { result: string; target_note_id: string | null; action_type: string } | null =
  null;

async function main(): Promise<void> {
  const { migrate } = await import('../../db/migrate');
  const { getDb, closeDb } = await import('../../db/client');
  const { setAgentToolsEnabled } = await import('../../auth/init');
  const { editNoteTool } = await import('./edit_note');

  try {
    migrate();
    setAgentToolsEnabled(true);

    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run('note-1', 'Original title', '{}', 'Original content', now, now);
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?, ?)`,
    ).run('note-soft-deleted', 'Soft deleted', '{}', 'soft deleted content', now, now, now + 1);

    titleOnlyResult = await editNoteTool.execute(
      { noteId: 'note-1', updates: { title: 'New title' } },
      {},
    );
    const t1 = db
      .prepare<[string], { title: string }>('SELECT title FROM notes WHERE id = ?')
      .get('note-1');
    titleOnlyNewTitle = t1?.title ?? null;

    replaceContentResult = await editNoteTool.execute(
      { noteId: 'note-1', updates: { content: 'Replaced content' } },
      {},
    );
    const t2 = db
      .prepare<[string], { content_text: string }>(
        'SELECT content_text FROM notes WHERE id = ?',
      )
      .get('note-1');
    replaceContentNewText = t2?.content_text ?? null;

    appendContentResult = await editNoteTool.execute(
      { noteId: 'note-1', updates: { appendContent: 'Extra line' } },
      {},
    );
    const t3 = db
      .prepare<[string], { content_text: string }>(
        'SELECT content_text FROM notes WHERE id = ?',
      )
      .get('note-1');
    appendContentNewText = t3?.content_text ?? null;

    multiFieldResult = await editNoteTool.execute(
      {
        noteId: 'note-1',
        updates: { title: 'Multi title', content: 'Multi content' },
      },
      {},
    );
    const t4 = db
      .prepare<[string], { title: string; content_text: string }>(
        'SELECT title, content_text FROM notes WHERE id = ?',
      )
      .get('note-1');
    multiFieldNewTitle = t4?.title ?? null;
    multiFieldNewText = t4?.content_text ?? null;

    nonexistentResult = await editNoteTool.execute(
      { noteId: 'nonexistent', updates: { title: 'whatever' } },
      {},
    );

    softDeletedResult = await editNoteTool.execute(
      { noteId: 'note-soft-deleted', updates: { title: 'cannot edit' } },
      {},
    );

    // Schema validation: empty updates should throw ZodError. Vercel
    // SDK wraps the schema and runs safeParse before execute; for an
    // empty updates object, refinement rejects.
    try {
      emptyUpdatesResult = await editNoteTool.execute(
        { noteId: 'note-1', updates: {} },
        {},
      );
    } catch (err) {
      emptyUpdatesResult = { threw: true, message: (err as Error).message };
    }

    // The last audit row corresponds to the soft-deleted-note attempt
    // (which has target_note_id=null). Query the first successful edit
    // (result IN ('ok', 'ok_with_embedding_disabled') AND target_note_id
    // IS NOT NULL) to verify the success-path audit shape.
    auditAfterEdit =
      db
        .prepare<[], {
          result: string;
          target_note_id: string | null;
          action_type: string;
        }>(
          `SELECT result, target_note_id, action_type FROM agent_actions
            WHERE action_type = 'edit_note'
              AND target_note_id IS NOT NULL
              AND result IN ('ok', 'ok_with_embedding_disabled')
            ORDER BY created_at ASC LIMIT 1`,
        )
        .get() ?? null;
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'title-only edit returns {ok: true, noteId, title}',
      check: () =>
        (titleOnlyResult as { ok?: boolean; noteId?: string })?.ok === true &&
        (titleOnlyResult as { noteId?: string })?.noteId === 'note-1',
    },
    {
      name: 'title-only edit persisted new title',
      check: () => titleOnlyNewTitle === 'New title',
    },
    {
      name: 'content (replace) edit returns {ok: true}',
      check: () =>
        (replaceContentResult as { ok?: boolean })?.ok === true,
    },
    {
      name: 'content (replace) edit overwrote previous content',
      check: () => replaceContentNewText === 'Replaced content',
    },
    {
      name: 'appendContent edit returns {ok: true}',
      check: () =>
        (appendContentResult as { ok?: boolean })?.ok === true,
    },
    {
      name: 'appendContent edit appended with \\n\\n separator',
      check: () =>
        appendContentNewText !== null &&
        appendContentNewText.includes('Replaced content\n\nExtra line'),
    },
    {
      name: 'multi-field edit returns {ok: true}',
      check: () => (multiFieldResult as { ok?: boolean })?.ok === true,
    },
    {
      name: 'multi-field edit updated both title and content',
      check: () =>
        multiFieldNewTitle === 'Multi title' &&
        multiFieldNewText === 'Multi content',
    },
    {
      name: 'edit on nonexistent note returns {ok: false, error: "note_not_found"}',
      check: () =>
        (nonexistentResult as { ok?: boolean; error?: string })?.ok === false &&
        (nonexistentResult as { error?: string })?.error === 'note_not_found',
    },
    {
      name: 'edit on soft-deleted note returns {ok: false, error: "note_not_found"}',
      check: () =>
        (softDeletedResult as { ok?: boolean; error?: string })?.ok === false &&
        (softDeletedResult as { error?: string })?.error === 'note_not_found',
    },
    {
      name: 'empty updates object returns {ok:false, error:"invalid_arguments"}',
      check: () => {
        const r = emptyUpdatesResult as { ok?: boolean; error?: string } | null;
        return r?.ok === false && r?.error === 'invalid_arguments';
      },
    },
    {
      name: 'audit row records action_type=edit_note with target_note_id set',
      check: () =>
        auditAfterEdit !== null &&
        auditAfterEdit.action_type === 'edit_note' &&
        auditAfterEdit.target_note_id === 'note-1' &&
        (auditAfterEdit.result === 'ok' ||
          auditAfterEdit.result === 'ok_with_embedding_disabled'),
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