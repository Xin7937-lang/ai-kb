import { getDb } from '@/lib/db/client';

const db = getDb();

db.exec('DROP TABLE IF EXISTS test_trigram3');
db.exec(`
  CREATE VIRTUAL TABLE test_trigram3 USING fts5(
    content,
    tokenize='trigram'
  );
`);

db.exec(`
  INSERT INTO test_trigram3(content) VALUES
    ('数据库设计方案'),
    ('关于数据库的详细设计'),
    ('设计者需要数据库知识'),
    ('这是一个测试');
`);

// Test bm25 ranking
const rows = db
  .prepare('SELECT content, bm25(test_trigram3, 10.0, 1.0) as score FROM test_trigram3 WHERE test_trigram3 MATCH ? ORDER BY score')
  .all('数据库设计') as Array<{ content: string; score: number }>;

console.log('bm25 ranking for "数据库设计":');
for (const r of rows) {
  console.log(`  score=${r.score.toFixed(4)} content="${r.content}"`);
}

db.exec('DROP TABLE test_trigram3');
process.exit(0);
