// Smoke test: run migrations against a throwaway DB and verify schema.
// Run with: npx tsx scripts/smoke-db.ts

import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(tmpdir(), `ai-kb-smoke-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'smoke-test-password';

async function main() {
  const { migrate } = await import('../lib/db/migrate');
  const { getDb } = await import('../lib/db/client');
  const { initAuthFromEnv, getStoredPasswordHash } = await import('../lib/auth/init');
  const { encrypt, decrypt } = await import('../lib/crypto');
  const bcrypt = (await import('bcryptjs')).default;

  // 1. Migrations
  const r = migrate();
  console.log('migrations:', r);

  // 2. Schema sanity
  const db = getDb();
  const tables = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  console.log('tables:', tables);

  const expected = [
    '_migrations',
    'assets',
    'model_configs',
    'note_tags',
    'notes',
    'notes_fts',
    'settings',
    'tags',
  ];
  for (const t of expected) {
    if (!tables.includes(t)) {
      throw new Error(`missing table: ${t}`);
    }
  }
  console.log('schema OK');

  // 3. First-run password hash
  await initAuthFromEnv();
  const hash = getStoredPasswordHash();
  if (!hash) throw new Error('password not stored');
  const ok = await bcrypt.compare('smoke-test-password', hash);
  if (!ok) throw new Error('password hash mismatch');
  console.log('password hash OK');

  // 4. FTS insert/update/delete
  const noteId = 'n1';
  db.prepare(
    'INSERT INTO notes (id, title, content_json, content_text, created_at, updated_at) VALUES (?,?,?,?,?,?)',
  ).run(
    noteId,
    'hello world',
    JSON.stringify({ type: 'doc' }),
    'hello world from fts',
    Date.now(),
    Date.now(),
  );
  const hit = db
    .prepare<[string], { title: string }>(
      "SELECT title FROM notes_fts WHERE notes_fts MATCH ?",
    )
    .get('hello');
  if (!hit) throw new Error('FTS insert failed');
  console.log('FTS insert OK, matched title:', hit.title);

  db.prepare('UPDATE notes SET title = ?, content_text = ? WHERE id = ?').run(
    'updated title',
    'goodbye world',
    noteId,
  );
  const updated = db
    .prepare<[string], { title: string }>(
      "SELECT title FROM notes_fts WHERE notes_fts MATCH ?",
    )
    .get('updated');
  if (!updated) throw new Error('FTS update failed');
  console.log('FTS update OK');

  db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
  const gone = db
    .prepare<[string], { title: string }>(
      "SELECT title FROM notes_fts WHERE notes_fts MATCH ?",
    )
    .get('goodbye');
  if (gone) throw new Error('FTS delete failed');
  console.log('FTS delete OK');

  // 5. Crypto round-trip
  const secret = 'sk-live-1234567890';
  const enc = encrypt(secret);
  const dec = decrypt(enc);
  if (dec !== secret) throw new Error('crypto round-trip failed');
  console.log('crypto round-trip OK');

  console.log('\nALL SMOKE TESTS PASSED');
}

function cleanup() {
  // On Windows the better-sqlite3 handle holds an exclusive lock; closing
  // before unlink is mandatory. best-effort: ignore failures.
  try {
    const { getDb } = require('../lib/db/client') as typeof import('../lib/db/client');
    getDb().close();
  } catch {
    /* ignore */
  }
  for (const p of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error('SMOKE TEST FAILED:', err);
    cleanup();
    process.exit(1);
  });
