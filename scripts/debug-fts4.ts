import { getDb } from '@/lib/db/client';

const db = getDb();

// Get full content of rowid=9
const row = db.prepare('SELECT rowid, title, content_text FROM notes_fts WHERE rowid = 9').get() as { rowid: number; title: string; content_text: string };
console.log('rowid=9 title:', row.title);
console.log('rowid=9 content length:', row.content_text.length);

// Search for individual characters
const chars = ['数', '据', '库', '设', '计'];
for (const c of chars) {
  const idx = row.content_text.indexOf(c);
  console.log(`  contains '${c}': ${idx >= 0 ? 'yes at ' + idx : 'no'}`);
}

// Test MATCH for each character
for (const c of chars) {
  const result = db.prepare('SELECT COUNT(*) as c FROM notes_fts WHERE notes_fts MATCH ?').get(c) as { c: number };
  console.log(`MATCH '${c}': ${result.c} results`);
}

// Test MATCH for 数据库 with different syntax
const tests = [
  '数据库',
  '"数据库"',
  '数 据 库',
  '数 OR 据 OR 库',
];
for (const q of tests) {
  const result = db.prepare('SELECT rowid, title FROM notes_fts WHERE notes_fts MATCH ? LIMIT 3').all(q) as Array<{ rowid: number; title: string }>;
  console.log(`\nMATCH '${q}': ${result.length} results`);
  for (const r of result) {
    console.log(`  rowid=${r.rowid} title="${r.title}"`);
  }
}

// Check the tokenizer output using fts5vocab
const vocabExists = db.prepare("SELECT name FROM sqlite_master WHERE name = 'notes_fts_vocab'").get() as { name: string } | undefined;
if (!vocabExists) {
  db.exec('CREATE VIRTUAL TABLE notes_fts_vocab USING fts5vocab(notes_fts, row)');
}
const vocab = db.prepare('SELECT term, doc FROM notes_fts_vocab WHERE term IN ("数", "据", "库", "设", "计", "数据库", "设计")').all() as Array<{ term: string; doc: number }>;
console.log('\nVocabulary:');
for (const v of vocab) {
  console.log(`  term="${v.term}" docs=${v.doc}`);
}

process.exit(0);
