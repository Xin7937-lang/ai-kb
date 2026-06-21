import { getDb } from '@/lib/db/client';

const db = getDb();

// Check notes that contain '设计'
const rows = db.prepare("SELECT id, title, substr(content_text, 1, 200) as preview FROM notes WHERE content_text LIKE '%设计%'").all() as Array<{ id: string; title: string; preview: string }>;
console.log('Notes containing 设计:', rows.length);
for (const r of rows) {
  console.log('  ', r.id, r.title);
}

// Check notes_fts for the same
const ftsRows = db.prepare("SELECT rowid, title, content_text FROM notes_fts WHERE content_text LIKE '%设计%'").all() as Array<{ rowid: number; title: string; content_text: string }>;
console.log('notes_fts containing 设计:', ftsRows.length);

// Check the actual tokenizer behavior with MATCH
const segRows = db.prepare("SELECT rowid, title, content_text FROM notes_fts WHERE notes_fts MATCH '设计'").all() as Array<{ rowid: number; title: string; content_text: string }>;
console.log('notes_fts MATCH 设计:', segRows.length);
for (const r of segRows) {
  console.log('  ', r.rowid, r.title);
}

// Try with phrase syntax
const phraseRows = db.prepare('SELECT rowid, title, content_text FROM notes_fts WHERE notes_fts MATCH ?').all('"设计"') as Array<{ rowid: number; title: string; content_text: string }>;
console.log('notes_fts MATCH "设计":', phraseRows.length);

process.exit(0);
