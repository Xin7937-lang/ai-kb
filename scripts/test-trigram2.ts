import { getDb } from '@/lib/db/client';

const db = getDb();

// Create a test trigram FTS table
db.exec(`
  CREATE VIRTUAL TABLE test_trigram2 USING fts5(
    content,
    tokenize='trigram'
  );
`);

// Insert sample data
db.exec(`
  INSERT INTO test_trigram2(content) VALUES
    ('数据库设计方案'),
    ('关于数据库的详细设计'),
    ('设计者需要数据库知识'),
    ('这是一个测试'),
    ('npm 国内镜像源汇总');
`);

// Test queries
const queries = [
  '数据库设计',
  '数据库',
  '设计',
  '关于数据库',
  'npm 国内',
  '镜像源',
];

for (const q of queries) {
  const rows = db
    .prepare('SELECT content FROM test_trigram2 WHERE test_trigram2 MATCH ?')
    .all(q) as Array<{ content: string }>;
  console.log(`MATCH '${q}': ${rows.length} results`);
  for (const r of rows) {
    console.log(`  "${r.content}"`);
  }
}

// Test OR query
const orQueries = [
  '"数据库" OR "设计"',
  '数据库 OR 设计',
  '"npm" OR "镜像源"',
];
for (const q of orQueries) {
  const rows = db
    .prepare('SELECT content FROM test_trigram2 WHERE test_trigram2 MATCH ?')
    .all(q) as Array<{ content: string }>;
  console.log(`\nMATCH '${q}': ${rows.length} results`);
  for (const r of rows) {
    console.log(`  "${r.content}"`);
  }
}

// Test with prefix
db.exec('DROP TABLE test_trigram2');
process.exit(0);
