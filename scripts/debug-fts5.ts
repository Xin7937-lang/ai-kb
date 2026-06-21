import { getDb } from '@/lib/db/client';

const db = getDb();

// Drop and recreate vocab table
const vocabExists = db.prepare("SELECT name FROM sqlite_master WHERE name = 'notes_fts_vocab'").get() as { name: string } | undefined;
if (vocabExists) {
  db.exec('DROP TABLE notes_fts_vocab');
}
db.exec('CREATE VIRTUAL TABLE notes_fts_vocab USING fts5vocab(notes_fts, row)');

// Check tokens around '设计' and '数据库'
const vocab = db.prepare('SELECT term, doc FROM notes_fts_vocab WHERE term LIKE ?').all('%设计%') as Array<{ term: string; doc: number }>;
console.log('Tokens containing 设计:');
for (const v of vocab) {
  console.log(`  term="${v.term}" docs=${v.doc}`);
}

const vocab2 = db.prepare('SELECT term, doc FROM notes_fts_vocab WHERE term LIKE ?').all('%数据库%') as Array<{ term: string; doc: number }>;
console.log('\nTokens containing 数据库:');
for (const v of vocab2) {
  console.log(`  term="${v.term}" docs=${v.doc}`);
}

// Check all tokens that contain any CJK characters
const vocab3 = db.prepare("SELECT term, doc FROM notes_fts_vocab WHERE term GLOB '*[一-龥]*' LIMIT 20").all() as Array<{ term: string; doc: number }>;
console.log('\nSample CJK tokens:');
for (const v of vocab3) {
  console.log(`  term="${v.term}" docs=${v.doc}`);
}

process.exit(0);
