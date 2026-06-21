// Backfill CLI: walk every note (or just the ones without chunks when
// `--missing-only`), regenerate its chunks, and embed them. Re-runs are
// idempotent: `replaceNoteChunks` wipes the prior set first.
//
// Usage:
//   npm run embed-all          # every note
//   npm run embed-missing      # only notes without chunks

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// Load env BEFORE any import that transitively pulls in lib/env.ts.
// tsx hoists static imports above this code, so we delay everything
// (getDb, embeddings, migrate) via dynamic import() inside main().
loadEnvFile('.env.local');
loadEnvFile('.env');

const PROGRESS_EVERY = 10;

let closeDb: () => void = () => {};

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const missingOnly = args.has('--missing-only');

  // 1. Migrate
  const { migrate } = await import('@/lib/db/migrate');
  const m = migrate();
  if (m.applied.length > 0) {
    console.log(`[embed-all] applied migrations v${m.applied.join(', v')}`);
  }

  // 2. Detect extension
  const {
    detectEmbeddingEnabled,
    getEmbeddingLoadError,
    getDefaultEmbeddingModelId,
    isEmbeddingEnabled,
  } = await import('@/lib/ai/embeddings');
  const { NoDefaultEmbeddingModelError } = await import('@/lib/ai/errors');
  const dbModule = await import('@/lib/db/client');
  const { getDb } = dbModule;
  closeDb = dbModule.closeDb;
  const { replaceNoteChunks } = await import('@/lib/notes/queries');

  if (!detectEmbeddingEnabled()) {
    console.error(
      `[embed-all] FATAL: sqlite-vec extension not loaded: ${getEmbeddingLoadError() ?? 'unknown'}`,
    );
    process.exitCode = 1;
    return;
  }
  if (!isEmbeddingEnabled()) {
    console.error('[embed-all] FATAL: embedding flag flipped off after detect');
    process.exitCode = 1;
    return;
  }

  // 3. Default embedding model
  try {
    getDefaultEmbeddingModelId();
  } catch (err) {
    if (err instanceof NoDefaultEmbeddingModelError) {
      console.error(
        '[embed-all] FATAL: 请先在「设置 → 模型」中添加一个 kind=embedding 的默认模型',
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  // 4. Select target notes
  const db = getDb();
  const sql = missingOnly
    ? `SELECT id, length(content_text) AS len FROM notes
        WHERE id NOT IN (SELECT note_id FROM note_chunks)
        ORDER BY created_at ASC`
    : `SELECT id, length(content_text) AS len FROM notes ORDER BY created_at ASC`;
  const targets = db.prepare<[], { id: string; len: number }>(sql).all();
  if (targets.length === 0) {
    console.log('[embed-all] nothing to do');
    return;
  }
  console.log(
    `[embed-all] target: ${targets.length} note(s)${missingOnly ? ' (missing only)' : ''}`,
  );

  // 5. Walk
  const started = Date.now();
  let success = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const note = db.prepare<[string], { content_text: string }>(
      'SELECT content_text FROM notes WHERE id = ?',
    ).get(t.id);
    if (!note) {
      failed++;
      console.error(`[embed-all] ${i + 1}/${targets.length} ${t.id}: note disappeared`);
      continue;
    }
    try {
      const result = await replaceNoteChunks(t.id, note.content_text);
      if (result.error) {
        failed++;
        console.error(
          `[embed-all] ${i + 1}/${targets.length} ${t.id}: ${result.error}`,
        );
      } else {
        success++;
      }
    } catch (err) {
      failed++;
      console.error(
        `[embed-all] ${i + 1}/${targets.length} ${t.id}: ${(err as Error).message}`,
      );
    }
    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === targets.length) {
      const pct = Math.round(((i + 1) / targets.length) * 100);
      process.stdout.write(
        `\r[embed-all] ${i + 1}/${targets.length} (${pct}%)  ok=${success} fail=${failed}`,
      );
    }
  }
  process.stdout.write('\n');

  // 6. Summary
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[embed-all] done. 成功 ${success} / 失败 ${failed} / 耗时 ${elapsed}s`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    console.error('[embed-all] FAILED:', err);
    try {
      closeDb();
    } catch {
      // ignore — closeDb may have no-op stub if main() rejected before dynamic import
    }
    process.exit(1);
  });
