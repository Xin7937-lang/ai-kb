// lib/auth/agent-tools-settings.test.ts
//
// Throwaway test for the agent tools settings helpers (getAgentToolsEnabled,
// getAgentToolLimit). Mirrors the no-test-framework rule (AGENTS.md).
//
// Run: npx tsx lib/auth/agent-tools-settings.test.ts
//
// Exits 0 on success, 1 on any failed assertion.

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-agt-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'agt-test-password';

type Case = {
  name: string;
  check: () => boolean;
};

async function main(): Promise<void> {
  const { migrate } = await import('../db/migrate');
  const { getDb, closeDb } = await import('../db/client');
  const {
    setSetting,
    getAgentToolsEnabled,
    getAgentToolLimit,
    getAgentBatchEditDeleteEnabled,
  } = await import('./init');

  // All values are captured while the DB is open, then the DB is
  // closed + the file deleted before case iteration runs.
  let capturedEnabled: boolean | null = null;
  let capturedLimit: number | null = null;
  let capturedBatch: boolean | null = null;
  let enabledAfterTrue: boolean | null = null;
  let enabledAfterBad: boolean | null = null;
  let limitAfter20: number | null = null;
  let limitAfterBad: number | null = null;
  let batchAfterTrue: boolean | null = null;
  let batchAfterBad: boolean | null = null;
  let enabledAfterClear: boolean | null = null;
  let limitAfterClear: number | null = null;
  let batchAfterClear: boolean | null = null;

  try {
    migrate();

    const db = getDb();

    // Default seeded values (v9 migration seeds agent_tools_enabled='false',
    // agent_tool_limit='5'; v11 seeds agent_batch_edit_delete_enabled='false').
    capturedEnabled = getAgentToolsEnabled();
    capturedLimit = getAgentToolLimit();
    capturedBatch = getAgentBatchEditDeleteEnabled();

    setSetting('agent_tools_enabled', 'true');
    enabledAfterTrue = getAgentToolsEnabled();

    setSetting('agent_tools_enabled', 'not-a-bool');
    enabledAfterBad = getAgentToolsEnabled();

    setSetting('agent_tool_limit', '20');
    limitAfter20 = getAgentToolLimit();

    setSetting('agent_tool_limit', 'not-a-number');
    limitAfterBad = getAgentToolLimit();

    setSetting('agent_batch_edit_delete_enabled', 'true');
    batchAfterTrue = getAgentBatchEditDeleteEnabled();

    setSetting('agent_batch_edit_delete_enabled', 'not-a-bool');
    batchAfterBad = getAgentBatchEditDeleteEnabled();

    // Clear settings → fall back to defaults
    db.prepare('DELETE FROM settings WHERE key IN (?, ?, ?)').run(
      'agent_tools_enabled',
      'agent_tool_limit',
      'agent_batch_edit_delete_enabled',
    );
    enabledAfterClear = getAgentToolsEnabled();
    limitAfterClear = getAgentToolLimit();
    batchAfterClear = getAgentBatchEditDeleteEnabled();
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'getAgentToolsEnabled() → false when setting is "false" (default)',
      check: () => capturedEnabled === false,
    },
    {
      name: 'getAgentToolsEnabled() → true when setting is "true"',
      check: () => enabledAfterTrue === true,
    },
    {
      name: 'getAgentToolsEnabled() → false when setting is missing',
      check: () => enabledAfterClear === false,
    },
    {
      name: 'getAgentToolsEnabled() → false when setting is malformed',
      check: () => enabledAfterBad === false,
    },
    {
      name: 'getAgentToolLimit() → 5 when setting is "5" (default)',
      check: () => capturedLimit === 5,
    },
    {
      name: 'getAgentToolLimit() → 20 when setting is "20"',
      check: () => limitAfter20 === 20,
    },
    {
      name: 'getAgentToolLimit() → 5 when setting is missing (fallback default)',
      check: () => limitAfterClear === 5,
    },
    {
      name: 'getAgentToolLimit() → 5 when setting is malformed (fallback default)',
      check: () => limitAfterBad === 5,
    },
    {
      name: 'getAgentBatchEditDeleteEnabled() → false when setting is "false" (default)',
      check: () => capturedBatch === false,
    },
    {
      name: 'getAgentBatchEditDeleteEnabled() → true when setting is "true"',
      check: () => batchAfterTrue === true,
    },
    {
      name: 'getAgentBatchEditDeleteEnabled() → false when setting is missing',
      check: () => batchAfterClear === false,
    },
    {
      name: 'getAgentBatchEditDeleteEnabled() → false when setting is malformed',
      check: () => batchAfterBad === false,
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