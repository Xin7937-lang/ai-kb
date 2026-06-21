// Diagnostic script for chat RAG retrieval.
// Run with: npx tsx scripts/debug-chat-retrieval.ts "你的查询"

import { getDb } from '@/lib/db/client';
import { searchRelevantChunks } from '@/lib/ai/retrieval';
import { buildFtsOrQuery, searchNotesFts } from '@/lib/notes/queries';

const query = process.argv[2] || '笔记';

const db = getDb();

// 1. Basic stats
const noteCount = (db.prepare('SELECT COUNT(*) as c FROM notes').get() as { c: number }).c;
const chunkCount = (db.prepare('SELECT COUNT(*) as c FROM note_chunks').get() as { c: number }).c;
const vecCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE name = 'note_chunks_vec'").get() as { c: number }).c;

console.log('=== DB Stats ===');
console.log(`notes: ${noteCount}`);
console.log(`note_chunks: ${chunkCount}`);
console.log(`note_chunks_vec exists: ${vecCount > 0}`);

// 2. Show some notes
if (noteCount > 0) {
  const samples = db.prepare('SELECT id, title, substr(content_text, 1, 60) as preview FROM notes LIMIT 3').all() as Array<{ id: string; title: string; preview: string }>;
  console.log('\n=== Sample notes ===');
  for (const s of samples) {
    console.log(`  ${s.id} | ${s.title} | ${s.preview}...`);
  }
}

// 3. Test tokenization
console.log('\n=== Query analysis ===');
console.log(`raw query: "${query}"`);

// Reproduce the tokenization from retrieval.ts
function tokenizeQuery(q: string): string[] {
  return Array.from(
    new Set(
      q
        .toLowerCase()
        .split(/[\s,，。、;；:：!！?？()（）\[\]【】"'`~*\\/]+/g)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    ),
  );
}

const tokens = tokenizeQuery(query);
console.log(`tokens: ${JSON.stringify(tokens)}`);

// Reproduce extractSearchTerms
const SMART_QUERY_STOP_WORDS = new Set<string>([
  '的', '地', '得', '所', '是', '在', '了', '着', '过', '有', '没', '没有', '会', '能', '可以',
  '和', '与', '或', '还', '也', '都', '但', '但是', '然而', '不过', '且',
  '我', '你', '他', '她', '它', '们', '自己',
  '这', '那', '这个', '那个', '这些', '那些',
  '什么', '哪', '哪里', '哪些', '哪个', '怎么', '如何', '为什么', '为啥',
  '吗', '呢', '吧', '啊', '哦', '呀', '嗯', '嘛',
  '从', '到', '给', '对', '于', '把', '被', '让', '向', '以', '为', '跟',
  '内容', '信息', '笔记', '情况', '问题', '方面', '东西', '部分', '里面', '相关',
  '有关', '一样', '类似', '关系',
  '一些', '一下', '点', '些', '个', '种', '次', '下',
  '请', '帮我', '想要', '需要', '能否', '麻烦',
  '讲', '说', '告诉', '看', '找', '查', '写', '列出', '总结', '介绍',
]);

function extractSearchTerms(q: string): string[] {
  const toks = tokenizeQuery(q);
  const meaningful = toks.filter((t) => !SMART_QUERY_STOP_WORDS.has(t));
  return meaningful.length > 0 ? meaningful : toks;
}

const terms = extractSearchTerms(query);
console.log(`search terms: ${JSON.stringify(terms)}`);

const ftsQuery = buildFtsOrQuery(terms);
console.log(`FTS query: "${ftsQuery}"`);

// 4. Test searchNotesFts directly
console.log('\n=== searchNotesFts results ===');
const ftsResults = searchNotesFts(query, { limit: 5, ftsQuery: ftsQuery || undefined });
console.log(`Found ${ftsResults.length} notes via FTS`);
for (const r of ftsResults) {
  console.log(`  bm25=${r.bm25.toFixed(4)} | ${r.title} | ${r.preview.slice(0, 60)}...`);
}

// 5. Test searchRelevantChunks
console.log('\n=== searchRelevantChunks results ===');
searchRelevantChunks(query).then((chunks) => {
  console.log(`Found ${chunks.length} chunks`);
  for (const c of chunks) {
    console.log(`  score=${c.score.toFixed(4)} paths=${JSON.stringify(c.paths)} | ${c.title} | chunkId=${c.chunkId}`);
    console.log(`    content: ${c.content.slice(0, 200)}...`);
  }

  // 6. Test buildChatContext
  const { buildChatContext } = require('@/lib/ai/prompts');
  const context = buildChatContext(chunks.map((s) => ({
    chunkId: s.chunkId,
    noteId: s.noteId,
    title: s.title,
    content: s.content,
    tags: s.tags,
  })));
  console.log('\n=== Built context ===');
  console.log(context.slice(0, 2000));

  process.exit(0);
}).catch((err: unknown) => {
  console.error('Error:', err);
  process.exit(1);
});
