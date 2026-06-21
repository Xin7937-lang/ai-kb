// Count zero embedding vectors.

import { getDb } from '@/lib/db/client';
import { detectEmbeddingEnabled } from '@/lib/ai/embeddings';

detectEmbeddingEnabled();
const db = getDb();

const rows = db.prepare('SELECT chunk_id, embedding FROM note_chunks_vec').all() as Array<{ chunk_id: number; embedding: Buffer }>;

let zeroCount = 0;
let totalCount = 0;
for (const r of rows) {
  totalCount++;
  const vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
  let isZero = true;
  for (let i = 0; i < vec.length; i++) {
    if (vec[i] !== 0) {
      isZero = false;
      break;
    }
  }
  if (isZero) {
    zeroCount++;
    if (zeroCount <= 5) {
      console.log(`Zero vector: chunk_id=${r.chunk_id}`);
    }
  }
}

console.log(`\nTotal vectors: ${totalCount}`);
console.log(`Zero vectors: ${zeroCount} (${(zeroCount / totalCount * 100).toFixed(1)}%)`);

// Show chunks that correspond to zero vectors
if (zeroCount > 0) {
  const zeroIds = rows
    .filter((r) => {
      const vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
      for (let i = 0; i < vec.length; i++) {
        if (vec[i] !== 0) return false;
      }
      return true;
    })
    .map((r) => r.chunk_id)
    .slice(0, 10);

  const placeholders = zeroIds.map(() => '?').join(',');
  const chunks = db
    .prepare(`SELECT c.id, c.note_id, n.title, substr(c.content, 1, 80) as preview FROM note_chunks c JOIN notes n ON n.id = c.note_id WHERE c.id IN (${placeholders})`)
    .all(...zeroIds) as Array<{ id: number; note_id: string; title: string; preview: string }>;

  console.log('\nSample zero-vector chunks:');
  for (const c of chunks) {
    console.log(`  chunk_id=${c.id} note_id=${c.note_id} title="${c.title}" preview="${c.preview}"`);
  }
}

process.exit(0);
