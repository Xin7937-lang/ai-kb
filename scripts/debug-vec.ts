// Debug embedding vectors in the database.

import { getDb } from '@/lib/db/client';
import { detectEmbeddingEnabled } from '@/lib/ai/embeddings';

detectEmbeddingEnabled();
const db = getDb();

// Check if vec table exists and has data
const vecInfo = db.prepare("SELECT name FROM sqlite_master WHERE name = 'note_chunks_vec'").get() as { name: string } | undefined;
if (!vecInfo) {
  console.log('note_chunks_vec table does not exist');
  process.exit(0);
}

const vecCount = (db.prepare('SELECT COUNT(*) as c FROM note_chunks_vec').get() as { c: number }).c;
console.log(`note_chunks_vec rows: ${vecCount}`);

// Check if vectors are non-zero
const sample = db.prepare('SELECT chunk_id, embedding FROM note_chunks_vec LIMIT 3').all() as Array<{ chunk_id: number; embedding: Buffer }>;
for (const s of sample) {
  const vec = new Float32Array(s.embedding.buffer, s.embedding.byteOffset, s.embedding.byteLength / 4);
  let nonZero = 0;
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    if (vec[i] !== 0) nonZero++;
    sum += vec[i];
  }
  console.log(`chunk_id=${s.chunk_id} dim=${vec.length} nonZero=${nonZero} sum=${sum.toFixed(4)}`);
  console.log(`  first 10: ${Array.from(vec.slice(0, 10)).map((v) => v.toFixed(4)).join(', ')}`);
}

// Test KNN for a specific chunk to see if vec search works at all
const firstChunk = db.prepare('SELECT chunk_id, embedding FROM note_chunks_vec LIMIT 1').get() as { chunk_id: number; embedding: Buffer } | undefined;
if (firstChunk) {
  console.log('\n=== Self-similarity KNN test ===');
  const rows = db
    .prepare<Buffer, { chunk_id: number; distance: number }>(
      'SELECT chunk_id, distance FROM note_chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 3',
    )
    .all(firstChunk.embedding) as Array<{ chunk_id: number; distance: number }>;
  for (const r of rows) {
    console.log(`  chunk_id=${r.chunk_id} distance=${r.distance.toFixed(6)}`);
  }
}

process.exit(0);
