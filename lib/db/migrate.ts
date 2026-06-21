// Idempotent migration runner.
//
// On startup we apply any pending migrations inside a transaction. Each
// migration writes a row into `_migrations` so subsequent runs skip it.

import type { Database } from 'better-sqlite3';
import { getDb } from './client';
import { migrations } from './migrations';

const SCHEMA_VERSION = Math.max(...migrations.map((m) => m.version));

export function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

export function getAppliedVersions(db: Database): Set<number> {
  ensureMigrationsTable(db);
  const rows = db
    .prepare<[], { version: number }>('SELECT version FROM _migrations')
    .all();
  return new Set(rows.map((r) => r.version));
}

/**
 * Apply any pending migrations. Safe to call on every startup.
 */
export function migrate(): { applied: number[]; current: number } {
  const db = getDb();
  const applied = getAppliedVersions(db);

  const pending = migrations
    .slice()
    .sort((a, b) => a.version - b.version)
    .filter((m) => !applied.has(m.version));

  for (const m of pending) {
    const applyOne = db.transaction(() => {
      m.up(db);
      db.prepare(
        'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(m.version, m.name, Date.now());
    });
    applyOne();
  }

  return {
    applied: pending.map((m) => m.version),
    current: SCHEMA_VERSION,
  };
}
