// lib/db/migrations-v9.test.ts
//
// Throwaway integration test for the v9 migration (agent_actions table
// + agent_tools / agent_tool_limit settings defaults).
//
// Mirrors the project's "no unit-test framework" rule (AGENTS.md).
// Pattern follows scripts/smoke-db.ts for env + dynamic-import setup;
// test body uses the cases[] + check pattern from lib/notes/chunk.test.ts.
//
// Run: npx tsx lib/db/migrations-v9.test.ts
//
// Exits 0 on success, 1 on any failed assertion.

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Env MUST be set before any dynamic import of lib/db/* because
// lib/env.ts throws on module load if required vars are missing.
const tmpDb = path.join(
  tmpdir(),
  `ai-kb-mig-v9-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'mig-test-password';

type Case = {
  name: string;
  check: () => boolean | Promise<boolean>;
};

// Module-scoped state — captured BEFORE closeDb() so cases can run
// against pure data without re-opening the (now-deleted) DB file.
let tableExists = false;
let columnInfo: Array<{ name: string; type: string; pk: number }> = [];
let indexNames: string[] = [];
let agentToolsEnabledValue: string | null = null;
let agentToolLimitValue: string | null = null;

function hasColumn(name: string, type: string, isPk: boolean): boolean {
  const col = columnInfo.find((c) => c.name === name);
  if (!col) return false;
  if (col.type.toUpperCase() !== type.toUpperCase()) return false;
  if (isPk && col.pk !== 1) return false;
  return true;
}

function hasIndex(name: string): boolean {
  return indexNames.includes(name);
}

const cases: Case[] = [
  {
    name: 'agent_actions table exists after migrate',
    check: () => tableExists,
  },
  {
    name: 'agent_actions has id PK column (TEXT)',
    check: () => hasColumn('id', 'TEXT', true),
  },
  {
    name: 'agent_actions has conversation_id column (TEXT)',
    check: () => hasColumn('conversation_id', 'TEXT', false),
  },
  {
    name: 'agent_actions has action_type column (TEXT NOT NULL)',
    check: () => hasColumn('action_type', 'TEXT', false),
  },
  {
    name: 'agent_actions has target_note_id column (TEXT)',
    check: () => hasColumn('target_note_id', 'TEXT', false),
  },
  {
    name: 'agent_actions has params_json column (TEXT)',
    check: () => hasColumn('params_json', 'TEXT', false),
  },
  {
    name: 'agent_actions has result column (TEXT NOT NULL)',
    check: () => hasColumn('result', 'TEXT', false),
  },
  {
    name: 'agent_actions has error_message column (TEXT)',
    check: () => hasColumn('error_message', 'TEXT', false),
  },
  {
    name: 'agent_actions has created_at column (INTEGER NOT NULL)',
    check: () => hasColumn('created_at', 'INTEGER', false),
  },
  {
    name: 'agent_actions has index on conversation_id',
    check: () => hasIndex('idx_agent_actions_conv'),
  },
  {
    name: 'agent_actions has index on created_at',
    check: () => hasIndex('idx_agent_actions_created'),
  },
  {
    name: 'agent_tools_enabled setting seeded to false',
    check: () => agentToolsEnabledValue === 'false',
  },
  {
    name: 'agent_tool_limit setting seeded to 5',
    check: () => agentToolLimitValue === '5',
  },
];

async function main(): Promise<void> {
  // Dynamic imports (after env setup) — static imports would hoist and
  // trigger lib/env.ts to throw before env vars are set.
  const { migrate } = await import('./migrate');
  const { getDb, closeDb } = await import('./client');
  const { getSetting } = await import('@/lib/auth/init');

  try {
    const result = migrate();
    if (!result.applied.includes(9)) {
      console.error('FAIL: v9 migration was not applied');
      console.error(`  applied: ${result.applied.join(', ')}`);
      process.exit(1);
    }

    const db = getDb();
    const tbl = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_actions'",
      )
      .get();
    tableExists = tbl !== undefined;

    if (tableExists) {
      columnInfo = db
        .prepare<[], { name: string; type: string; pk: number }>(
          'PRAGMA table_info(agent_actions)',
        )
        .all();

      const idxs = db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_actions' AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      indexNames = idxs.map((i) => i.name);
    }

    // Capture settings values while DB is still open.
    agentToolsEnabledValue = getSetting('agent_tools_enabled');
    agentToolLimitValue = getSetting('agent_tool_limit');
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  // Run cases against captured state.
  let failed = 0;
  for (const c of cases) {
    try {
      if (!(await c.check())) {
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