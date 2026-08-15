// lib/ai/tools-config.test.ts
//
// Throwaway test for buildToolsConfig(). Mirrors the no-test-framework
// rule (AGENTS.md).
//
// Run: npx tsx lib/ai/tools-config.test.ts
//
// Exits 0 on success, 1 on any failed assertion.

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-tc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'tc-test';

type Case = {
  name: string;
  check: () => boolean;
};

async function main(): Promise<void> {
  const { migrate } = await import('../db/migrate');
  const { closeDb } = await import('../db/client');
  const { setAgentToolsEnabled } = await import('../auth/init');
  const { buildToolsConfig } = await import('./tools-config');

  // Declared outside the try so the case closures can read them
  // (block-scoped const would not be visible after the finally).
  let offKeys: string[] = [];
  let onKeys: string[] = [];
  let offKeysAfter: string[] = [];

  try {
    migrate();

    offKeys = Object.keys(buildToolsConfig()).sort();
    setAgentToolsEnabled(true);
    onKeys = Object.keys(buildToolsConfig()).sort();
    setAgentToolsEnabled(false);
    offKeysAfter = Object.keys(buildToolsConfig()).sort();
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'toggle off → returns 0 keys',
      check: () => offKeys.length === 0,
    },
    {
      name: 'toggle on → returns create_note + read_note keys',
      check: () =>
        onKeys.length === 2 &&
        onKeys.includes('create_note') &&
        onKeys.includes('read_note'),
    },
    {
      name: 'toggle off again → 0 keys (idempotent)',
      check: () => offKeysAfter.length === 0,
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