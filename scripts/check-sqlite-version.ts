import { getDb } from '@/lib/db/client';
const db = getDb();
const v = db.prepare('SELECT sqlite_version() as v').get() as { v: string };
console.log('SQLite version:', v.v);

// Test if trigram tokenizer is available
try {
  db.exec('CREATE VIRTUAL TABLE _test_trigram USING fts5(content, tokenize="trigram")');
  db.exec('DROP TABLE _test_trigram');
  console.log('trigram tokenizer: available');
} catch (e) {
  console.log('trigram tokenizer: NOT available');
  console.log('Error:', (e as Error).message);
}

process.exit(0);
