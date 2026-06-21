// First-time setup: apply DB migrations and (if APP_PASSWORD is set in
// env) hash it into the `settings` table.
//
// Run once on the host before the first server start, or any time the
// schema needs to upgrade:
//   npm run bootstrap
//
// Safe to re-run: migrate() is idempotent (tracks applied versions in
// _migrations); initAuthFromEnv() only writes when no password hash
// exists yet.
//
// The .env loader note: tsx does NOT auto-load .env files the way
// `next dev` / `next start` do. We hand-load .env.local here so the
// same vars the running server sees are visible to the bootstrap.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnvFile(filename: string): void {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip matching surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Don't override an already-set env var (allow CI overrides)
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

import { migrate } from '../lib/db/migrate';
import { initAuthFromEnv } from '../lib/auth/init';
import { getStoredPasswordHash } from '../lib/auth/init';
import { closeDb } from '../lib/db/client';

async function main() {
  // 1. Apply pending migrations
  const m = migrate();
  if (m.applied.length > 0) {
    console.log(
      `[bootstrap] applied migrations v${m.applied.join(', v')} (now at v${m.current})`,
    );
  } else {
    console.log(`[bootstrap] schema up to date (v${m.current})`);
  }

  // 2. First-run password hash (if APP_PASSWORD is in env)
  await initAuthFromEnv();

  // 3. Summary
  const hash = getStoredPasswordHash();
  if (hash) {
    console.log('[bootstrap] ready — password hash present in settings table');
  } else {
    console.warn(
      '[bootstrap] no password configured. Set APP_PASSWORD in .env and re-run, ' +
        'or log in to the app and use the account settings page to set one.',
    );
  }

  // 4. Reminder for the embedding CLI (does not run anything by itself).
  console.log(
    '[bootstrap] tip: if you plan to use semantic chat, add a kind=embedding model ' +
      'in Settings → Models, then run `npm run embed-all` to backfill existing notes.',
  );
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[bootstrap] FAILED:', err);
    process.exit(1);
  });
