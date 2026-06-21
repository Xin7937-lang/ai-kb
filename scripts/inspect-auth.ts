// Quick diagnostic: read the password hash from settings and try to verify
// against the env APP_PASSWORD. Mirrors what the dev server does on login.
//
// Like scripts/bootstrap.ts, we hand-load .env.local because tsx does not
// auto-load .env files the way `next dev` / `next start` do.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnvFile(filename: string): void {
  const p = resolve(process.cwd(), filename);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

import bcrypt from 'bcryptjs';
import { getDb, closeDb } from '../lib/db/client';

async function main() {
  const db = getDb();

  // 1. List every key in settings so we can see the full auth state.
  const all = db
    .prepare<[], { key: string; value: string }>(
      'SELECT key, value FROM settings ORDER BY key',
    )
    .all();

  console.log('=== settings table contents ===');
  for (const row of all) {
    // Mask long values so the hash isn't dumped to the terminal in full
    const display = row.value.length > 80
      ? `${row.value.slice(0, 32)}…(${row.value.length} chars)`
      : row.value;
    console.log(`  ${row.key} = ${display}`);
  }
  console.log(`(${all.length} row(s))`);

  // 2. Try the env password against the stored hash.
  const hashRow = db
    .prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    )
    .get('password_hash');

  const envPw = process.env.APP_PASSWORD;
  console.log('\n=== env ===');
  console.log(`APP_PASSWORD in env: ${envPw === undefined ? '(unset)' : JSON.stringify(envPw)}`);

  if (!hashRow) {
    console.log('No password_hash row in settings. initAuthFromEnv() needs to be run.');
  } else if (!envPw) {
    console.log('Hash exists but APP_PASSWORD is not in env; cannot compare.');
  } else {
    const ok = await bcrypt.compare(envPw, hashRow.value);
    console.log(`bcrypt.compare(APP_PASSWORD, stored hash) = ${ok}`);
    if (!ok) {
      console.log('-> Stored password does NOT match .env APP_PASSWORD.');
    }
  }

  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
