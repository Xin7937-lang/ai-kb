import { getDb } from '@/lib/db/client';

const db = getDb();

// Check the actual content of matching notes for '数据库'
const dbRows = db.prepare("SELECT rowid, title, content_text FROM notes_fts WHERE notes_fts MATCH '数据库'").all() as Array<{ rowid: number; title: string; content_text: string }>;
console.log('MATCH 数据库:');
for (const r of dbRows) {
  console.log(`  rowid=${r.rowid} title="${r.title}"`);
  console.log(`  content: ${r.content_text.slice(0, 100)}...`);
}

// Check if the notes_fts data matches notes table
const noteRows = db.prepare("SELECT rowid, id, title, substr(content_text, 1, 100) as preview FROM notes WHERE id IN ('PEsTVTgQaDSA', 'P6RLcMDggsdT')").all() as Array<{ rowid: number; id: string; title: string; preview: string }>;
console.log('\nActual notes:');
for (const r of noteRows) {
  console.log(`  rowid=${r.rowid} id=${r.id} title="${r.title}"`);
  console.log(`  content: ${r.preview}...`);
}

// Check if 设计 appears in the notes_fts content_text for these rows
const ftsCheck = db.prepare("SELECT rowid, title, content_text FROM notes_fts WHERE rowid IN (SELECT rowid FROM notes WHERE id IN ('PEsTVTgQaDSA', 'P6RLcMDggsdT'))").all() as Array<{ rowid: number; title: string; content_text: string }>;
console.log('\nnotes_fts rows for these notes:');
for (const r of ftsCheck) {
  const hasDesign = r.content_text.includes('设计');
  console.log(`  rowid=${r.rowid} has 设计=${hasDesign} content="${r.content_text.slice(0, 80)}..."`);
}

// Try different MATCH syntaxes for 设计
const tests = [
  "设计",
  '"设计"',
  '"设" "计"',
  '设计*',
];
for (const q of tests) {
  const rows = db.prepare('SELECT COUNT(*) as c FROM notes_fts WHERE notes_fts MATCH ?').get(q) as { c: number };
  console.log(`\nMATCH ${q}: ${rows.c} results`);
}

process.exit(0);
