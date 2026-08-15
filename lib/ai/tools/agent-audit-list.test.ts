// lib/ai/tools/agent-audit-list.test.ts
//
// Throwaway integration test for listAgentActions. Mirrors the no-
// test-framework rule (AGENTS.md); cases[] + check pattern.
//
// Run: npx tsx lib/ai/tools/agent-audit-list.test.ts

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'list-test';

type Case = {
  name: string;
  check: () => boolean;
};

let count: number | null = null;
let firstId: string | null = null;
let lastId: string | null = null;
let middleId: string | null = null;
let noConv: number | null = null;
let filteredIds: string[] | null = null;
let defaultLimit: number | null = null;
let offsetSkip: string[] | null = null;

async function main(): Promise<void> {
  const { migrate } = await import('../../db/migrate');
  const { getDb, closeDb } = await import('../../db/client');
  const { listAgentActions } = await import('./agent-audit');

  try {
    migrate();

    // Seed 5 rows with different timestamps + 2 with different conversation_id.
    const db = getDb();
    const base = Date.now();
    db.prepare(
      `INSERT INTO agent_actions
         (id, conversation_id, action_type, target_note_id, params_json, result, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('act-1', 'conv-A', 'create_note', null, '{}', 'ok', null, base - 4000);
    db.prepare(
      `INSERT INTO agent_actions
         (id, conversation_id, action_type, target_note_id, params_json, result, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('act-2', 'conv-A', 'create_note', 'note-1', '{"title":"x"}', 'ok', null, base - 3000);
    db.prepare(
      `INSERT INTO agent_actions
         (id, conversation_id, action_type, target_note_id, params_json, result, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('act-3', 'conv-A', 'create_note', 'note-2', '{}', 'error', 'db locked', base - 2000);
    db.prepare(
      `INSERT INTO agent_actions
         (id, conversation_id, action_type, target_note_id, params_json, result, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('act-4', 'conv-B', 'read_note', 'note-3', '{}', 'ok', null, base - 1000);
    db.prepare(
      `INSERT INTO agent_actions
         (id, conversation_id, action_type, target_note_id, params_json, result, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('act-5', null, 'create_note', null, '{}', 'ok', null, base);

    count = listAgentActions().length;
    firstId = listAgentActions({ limit: 1 })[0]?.id ?? null;
    lastId = listAgentActions({ limit: 1, offset: 4 })[0]?.id ?? null;
    middleId = listAgentActions({ offset: 2, limit: 1 })[0]?.id ?? null;

    noConv = listAgentActions({ conversationId: 'nonexistent' }).length;

    filteredIds = listAgentActions({ conversationId: 'conv-A' }).map((r) => r.id);

    defaultLimit = listAgentActions({ limit: 100 }).length;

    offsetSkip = listAgentActions({ offset: 1, limit: 2 }).map((r) => r.id);
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'no filter → returns all 5 rows',
      check: () => count === 5,
    },
    {
      name: 'newest first → first id is act-5',
      check: () => firstId === 'act-5',
    },
    {
      name: 'oldest last → last id is act-1',
      check: () => lastId === 'act-1',
    },
    {
      name: 'offset+limit picks middle row',
      check: () => middleId === 'act-3',
    },
    {
      name: 'conversationId filter → only conv-A rows',
      check: () =>
        filteredIds !== null &&
        filteredIds.length === 3 &&
        filteredIds.includes('act-1') &&
        filteredIds.includes('act-2') &&
        filteredIds.includes('act-3') &&
        !filteredIds.includes('act-4') &&
        !filteredIds.includes('act-5'),
    },
    {
      name: 'conversationId filter no matches → empty',
      check: () => noConv === 0,
    },
    {
      name: 'offset+limit returns 2 rows starting at index 1',
      check: () =>
        offsetSkip !== null &&
        offsetSkip.length === 2 &&
        offsetSkip[0] === 'act-4' &&
        offsetSkip[1] === 'act-3',
    },
    {
      name: 'limit=100 returns all 5 (sanity check on filter shape)',
      check: () => defaultLimit === 5,
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