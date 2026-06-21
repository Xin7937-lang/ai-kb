// Debug FTS5 index status.

import { getDb } from '@/lib/db/client';

const db = getDb();

// Check notes_fts row count
const ftsCount = (db.prepare('SELECT COUNT(*) as c FROM notes_fts').get() as { c: number }).c;
const notesCount = (db.prepare('SELECT COUNT(*) as c FROM notes').get() as { c: number }).c;
console.log(`notes: ${notesCount}, notes_fts: ${ftsCount}`);

// Test a simple FTS5 query
const testQueries = ['数据库', '设计', 'npm', 'hermes', '淘宝'];
for (const q of testQueries) {
  const rows = db
    .prepare(`SELECT rowid, title, content_text FROM notes_fts WHERE notes_fts MATCH ? LIMIT 3`)
    .all(`"${q}"`) as Array<{ rowid: number; title: string; content_text: string }>;
  console.log(`\nFTS query "${q}": ${rows.length} results`);
  for (const r of rows) {
    console.log(`  rowid=${r.rowid} title="${r.title}"`);
  }
}

// Check if there are any notes with empty content_text
const emptyNotes = db.prepare("SELECT id, title FROM notes WHERE content_text = '' OR content_text IS NULL").all() as Array<{ id: string; title: string }>;
console.log(`\nNotes with empty content_text: ${emptyNotes.length}`);
for (const n of emptyNotes) {
  console.log(`  ${n.id}: ${n.title}`);
}

// Test phrase vs OR query for Chinese
console.log('\n=== Chinese query comparison ===');
const phraseResult = db.prepare('SELECT COUNT(*) as c FROM notes_fts WHERE notes_fts MATCH ?').get('"数据库设计"') as { c: number };
const orResult = db.prepare('SELECT COUNT(*) as c FROM notes_fts WHERE notes_fts MATCH ?').get('"数据库" OR "设计"') as { c: number };
console.log(`Phrase "数据库设计": ${phraseResult.c} results`);
console.log(`OR "数据库" OR "设计": ${orResult.c} results`);

process.exit(0);
