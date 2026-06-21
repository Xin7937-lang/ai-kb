// One-shot: overwrite the stored password hash with a fresh bcrypt of
// APP_PASSWORD from the env. Use this when the stored hash has drifted
// from the env (e.g. password was rotated in-app and forgotten, or a
// backup DB was restored).
//
// initAuthFromEnv() (called by `npm run bootstrap`) intentionally skips
// re-hashing once a row exists, so this script is the manual override.
//
// Like scripts/bootstrap.ts, hand-loads .env.local because tsx does not
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
  const plaintext = process.env.APP_PASSWORD;
  if (!plaintext) {
    console.error(
      '[reset-password] APP_PASSWORD is not set in env (or .env.local). ' +
        'Set it and re-run, or edit the script to pass a plaintext value directly.',
    );
    process.exit(2);
  }

  const db = getDb();

  // Show the current state for a paper trail.
  const before = db
    .prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    )
    .get('password_hash');
  if (before) {
    console.log(
      `[reset-password] existing hash: ${before.value.slice(0, 24)}…(${before.value.length} chars)`,
    );
  } else {
    console.log('[reset-password] no prior hash in settings; will INSERT.');
  }

  const hash = await bcrypt.hash(plaintext, 12);
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('password_hash', hash);

  // Sanity-check: verify the new hash actually matches the plaintext we
  // just hashed. A mismatch here would mean the bcrypt library and the
  // stored format are out of sync -- fail loudly rather than silently
  // locking the user out again.
  const after = db
    .prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    )
    .get('password_hash');
  if (!after) throw new Error('hash not found after write -- DB broken?');
  const ok = await bcrypt.compare(plaintext, after.value);
  if (!ok) {
    throw new Error(
      'post-write verification failed -- bcrypt round-trip broken. ' +
        'The DB still holds an unverifiable hash. Do NOT log in until this is fixed.',
    );
  }

  console.log(
    `[reset-password] wrote new hash (${after.value.slice(0, 24)}…) and verified ` +
      `it round-trips against APP_PASSWORD (${plaintext.length} chars).`,
  );
  console.log('[reset-password] done. You can now log in with APP_PASSWORD.');

  closeDb();
}

main().catch((err) => {
  console.error('[reset-password] FAILED:', err);
  process.exit(1);
});
