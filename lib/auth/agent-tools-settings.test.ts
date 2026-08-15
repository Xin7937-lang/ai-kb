// lib/auth/agent-tools-settings.test.ts
//
// Throwaway test for the agent tools settings helpers (getAgentToolsEnabled,
// getAgentToolLimit). Mirrors the no-test-framework rule (AGENTS.md);
// uses cases[] + check pattern from lib/notes/chunk.test.ts.
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
  setup?: () => void | Promise<void>;
  check: () => boolean | Promise<boolean>;
};

let capturedEnabled: boolean | null = null;
let capturedLimit: number | null = null;

const cases: Case[] = [
  {
    name: 'getAgentToolsEnabled() → false when setting is "false"',
    check: () => capturedEnabled === false,
  },
  {
    name: 'getAgentToolsEnabled() → true when setting is "true"',
    setup: () => {
      capturedEnabled = null; // will be re-captured in main with toggle on
    },
    check: () => true, // placeholder, real assertion in main
  },
  {
    name: 'getAgentToolLimit() → 5 when setting is "5"',
    check: () => capturedLimit === 5,
  },
  {
    name: 'getAgentToolLimit() → 20 when setting is "20"',
    setup: () => {
      capturedLimit = null;
    },
    check: () => true, // placeholder
  },
];

async function main(): Promise<void> {
  const { migrate } = await import('../db/migrate');
  const { getDb, closeDb } = await import('../db/client');
  const { getSetting, setSetting, getAgentToolsEnabled, getAgentToolLimit } =
    await import('./init');

  try {
    migrate();

    const db = getDb();

    // Capture values in known DB states. Cases are checked against
    // these captured values so we don't need the DB open during
    // case iteration.

    // Toggle explicitly false (the migration seeds it as 'false').
    capturedEnabled = getAgentToolsEnabled();
    capturedLimit = getAgentToolLimit();

    // Override via setSetting and capture again
    setSetting('agent_tools_enabled', 'true');
    const enabledAfterTrue = getAgentToolsEnabled();

    setSetting('agent_tools_enabled', 'not-a-bool');
    const enabledAfterBad = getAgentToolsEnabled();

    setSetting('agent_tool_limit', '20');
    const limitAfter20 = getAgentToolLimit();

    setSetting('agent_tool_limit', 'not-a-number');
    const limitAfterBad = getAgentToolLimit();

    // Clear settings (fall back to defaults)
    db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(
      'agent_tools_enabled',
      'agent_tool_limit',
    );
    const enabledAfterClear = getAgentToolsEnabled();
    const limitAfterClear = getAgentToolLimit();

    // Run cases with the captured values
    let failed = 0;
    const explicitCases: Case[] = [
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
    ];

    for (const c of explicitCases) {
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
    console.log(`\nAll ${explicitCases.length} tests passed`);
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(1);
});