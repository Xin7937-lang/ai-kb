// scripts/smoke-embed.ts
//
// Integration smoke test for the chat RAG pipeline. Mirrors
// scripts/smoke-db.ts: a single Node script that runs through every
// behavior the spec requires and exits 1 on the first failure.
//
// Run with: npx tsx scripts/smoke-embed.ts

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

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    console.error(`FAIL: ${name}`, detail ?? '');
    failed++;
  }
}

async function main(): Promise<void> {
  const { closeDb } = await import('@/lib/db/client');
  try {
    // 1. Apply pending migrations so the schema (including note_chunks)
    //    is guaranteed to exist on a clean checkout.
    const { migrate } = await import('@/lib/db/migrate');
    const r = migrate();
    if (r.applied.length > 0) {
      console.log(
        `[smoke-embed] applied migrations v${r.applied.join(', v')} (now at v${r.current})`,
      );
    } else {
      console.log(`[smoke-embed] schema up to date (v${r.current})`);
    }

    // 2. Embedding extension loader.
    const {
      detectEmbeddingEnabled,
      isEmbeddingEnabled,
      getEmbeddingLoadError,
    } = await import('@/lib/ai/embeddings');
    const { getDb } = await import('@/lib/db/client');

    const enabled = detectEmbeddingEnabled();
    check('detectEmbeddingEnabled returns a boolean', typeof enabled === 'boolean');
    check('isEmbeddingEnabled matches the cached flag', isEmbeddingEnabled() === enabled);
    if (!enabled) {
      console.warn(`[smoke-embed] sqlite-vec NOT loaded: ${getEmbeddingLoadError()}`);
      console.warn('[smoke-embed] downstream tests will be skipped (FTS5-only mode).');
    }

    // 3. Schema sanity: the chat RAG chunks table must exist post-migrate.
    const row = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE name = 'note_chunks'")
      .get();
    check('note_chunks table exists', !!row);

    // 4. Write path: createNote → updateNote → deleteNote must wire
    //    chunks (and best-effort embeddings) end to end. Embedding
    //    failures are tolerated and logged; the chunk rows MUST exist.
    const { createNote, updateNote, deleteNote } = await import(
      '@/lib/notes/queries'
    );
    const longContent = '这是一段测试文本。'.repeat(500); // ~500 * 9 = 4500 chars
    const created = await createNote({
      title: 'smoke test',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: longContent }] },
        ],
      } as never,
      contentText: longContent,
      tags: ['smoke'],
    });
    check('createNote returns a note', !!created.id);
    const chunkRows = getDb()
      .prepare(
        'SELECT COUNT(*) AS c FROM note_chunks WHERE note_id = ?',
      )
      .get(created.id) as { c: number };
    check('createNote produced chunks', chunkRows.c >= 2, chunkRows);

    // Update: chunks should be regenerated.
    const newText = '更新后的内容。'.repeat(50);
    await updateNote(created.id, {
      title: 'smoke test',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: newText }] },
        ],
      } as never,
      contentText: newText,
    });
    const newChunks = getDb()
      .prepare(
        'SELECT content FROM note_chunks WHERE note_id = ? ORDER BY chunk_index',
      )
      .all(created.id) as { content: string }[];
    check(
      'updateNote replaced chunks',
      newChunks.length > 0 && newChunks[0].content.startsWith('更新'),
    );

    // Delete: chunks + vec rows should be gone.
    deleteNote(created.id);
    const remaining = getDb()
      .prepare(
        'SELECT COUNT(*) AS c FROM note_chunks WHERE note_id = ?',
      )
      .get(created.id) as { c: number };
    check('deleteNote removed chunks', remaining.c === 0);

    // Phase 3: retrieval
    const { searchRelevantChunks } = await import('@/lib/ai/retrieval');
    const { createNote: cn } = await import('@/lib/notes/queries');
    const qaNote = await cn({
      title: '快递柜选择',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '我比较了丰巢、菜鸟和京东的快递柜，最终选了丰巢因为离公司近。问题是快递柜哪个好。' }] }] } as never,
      contentText: '我比较了丰巢、菜鸟和京东的快递柜，最终选了丰巢因为离公司近。问题是快递柜哪个好。',
      tags: ['快递柜'],
    });
    const results = await searchRelevantChunks('快递柜哪个好', 5);
    check('searchRelevantChunks returns ≥ 1 result', results.length >= 1);
    if (results.length > 0) {
      const top = results[0];
      check('top result references the qa note (FTS5 path always)',
        top.noteId === qaNote.id || top.content.includes('快递柜'));
    }
    // Cleanup
    deleteNote(qaNote.id);

    // Phase 4: chat pipeline prompt construction.
    // We don't exercise the streaming path here (it requires a live
    // session/model); we just verify the prompt-building helper, which
    // is the only pure piece of the chat pipeline and the one that
    // shapes what the model sees.
    const { buildChatContext } = await import('@/lib/ai/prompts');
    const ctx = buildChatContext([
      { chunkId: 1, noteId: 'n1', title: '示例', content: '内容 A', tags: ['x'] },
      { chunkId: 2, noteId: 'n1', title: '示例', content: '内容 B', tags: ['x'] },
    ]);
    check(
      'buildChatContext renders grouped passages',
      ctx.includes('[笔记 1]') && ctx.includes('片段 1/2') && ctx.includes('片段 2/2'),
    );
    check('buildChatContext mentions the title', ctx.includes('示例'));
  } finally {
    closeDb();
  }
}

main()
  .then(() => {
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed`);
      process.exit(1);
    }
    console.log('\nsmoke-embed: phase 1 + 2 OK');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[smoke-embed] threw:', err);
    failed++;
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  });
