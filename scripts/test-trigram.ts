import { getDb } from '@/lib/db/client';

const db = getDb();

// Create a test trigram FTS table
db.exec(`
  CREATE VIRTUAL TABLE test_trigram USING fts5(
    title,
    content,
    tokenize='trigram'
  );
`);

// Insert sample data
db.exec(`
  INSERT INTO test_trigram(title, content) VALUES
    ('npm 国内镜像源汇总', 'npm 国内镜像源汇总\n\n1. 淘宝镜像（npmmirror）— 最推荐'),
    ('Hermes长期记忆满了问题解决方法', '一、系统自动处理机制\n\nHermes Agent 设计上有有限记忆机制'),
    ('数据库设计方案', '这是关于数据库设计的详细方案'),
    ('Openclaw技能说明', '以下是 /root/clawd/skills 目录下的 28 个技能');
`);

// Test various queries
const queries = [
  '数据库设计',
  '"数据库设计"',
  '设计',
  '数据库',
  '技能说明',
  '记忆机制',
];

for (const q of queries) {
  const rows = db
    .prepare('SELECT title, content FROM test_trigram WHERE test_trigram MATCH ?')
    .all(q) as Array<{ title: string; content: string }>;
  console.log(`\nMATCH '${q}': ${rows.length} results`);
  for (const r of rows) {
    console.log(`  title="${r.title}" content="${r.content.slice(0, 50)}..."`);
  }
}

// Cleanup
db.exec('DROP TABLE test_trigram');

process.exit(0);
