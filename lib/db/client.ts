// better-sqlite3 singleton + a small typed query helper layer.
//
// Why a singleton? better-sqlite3 connections are heavyweight and not designed
// to be opened per-request. We want one process-wide connection.
//
// WAL mode is enabled for better concurrent reads while a write is in progress.
// Foreign keys are enforced so `ON DELETE CASCADE` actually fires.
//
// In Next.js dev, hot-reload can re-evaluate this module. We stash the
// instance on globalThis to avoid leaking connections.

import Database, { type Database as DB } from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { DB_PATH } from '../env';

const GLOBAL_KEY = '__ai_kb_db__';
type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: DB };

function openDatabase(): DB {
  const dir = path.dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}

export function getDb(): DB {
  const g = globalThis as GlobalWithDb;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = openDatabase();
  }
  return g[GLOBAL_KEY];
}

/**
 * Convenience helper: run a function inside an immediate transaction.
 * Rolls back automatically on throw, commits on return.
 */
export function tx<T>(fn: (db: DB) => T): T {
  const db = getDb();
  const run = db.transaction(fn);
  return run(db);
}

/**
 * Close the singleton connection. Mainly for one-shot scripts (bootstrap,
 * smoke test) so the process can exit cleanly. No-op if never opened.
 */
export function closeDb(): void {
  const g = globalThis as GlobalWithDb;
  if (g[GLOBAL_KEY]) {
    g[GLOBAL_KEY]!.close();
    g[GLOBAL_KEY] = undefined;
  }
}
