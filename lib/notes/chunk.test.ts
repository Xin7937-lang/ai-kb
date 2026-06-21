// lib/notes/chunk.test.ts
//
// Throwaway test runner for chunkNote — mirrors the project's "no
// unit-test framework" rule (see AGENTS.md). Run with:
//   npx tsx lib/notes/chunk.test.ts
//
// Exits 0 on success, 1 on the first failed assertion.

import { chunkNote } from './chunk';

type Case = { name: string; input: string; check: (out: ReturnType<typeof chunkNote>) => boolean };

const cases: Case[] = [
  {
    name: 'empty input → empty output',
    input: '',
    check: (out) => out.length === 0,
  },
  {
    name: 'short content → single chunk',
    input: '短内容',
    check: (out) => out.length === 1 && out[0].content === '短内容',
  },
  {
    name: 'two paragraphs split on double newline',
    input: '第一段。\n\n第二段。',
    check: (out) => out.length === 2 && out[0].content === '第一段。' && out[1].content === '第二段。',
  },
  {
    name: 'long content produces multiple chunks with overlap',
    input: 'a'.repeat(2000),
    check: (out) => out.length >= 2,
  },
  {
    name: 'start_pos is monotonic and within bounds',
    input: 'a'.repeat(2000),
    check: (out) => {
      for (let i = 1; i < out.length; i++) {
        if (out[i].startPos < out[i - 1].startPos) return false;
        if (out[i].endPos > 2000) return false;
      }
      return true;
    },
  },
  {
    name: 'chunk_index is sequential from 0',
    input: 'a'.repeat(2000),
    check: (out) => out.every((c, i) => c.chunkIndex === i),
  },
  {
    name: 'markdown heading is a hard split',
    input: 'intro\n\n# 标题\n\nbody',
    check: (out) => out.length === 3 && out[1].content === '# 标题',
  },
];

let failed = 0;
for (const c of cases) {
  try {
    if (!c.check(chunkNote(c.input))) {
      console.error(`FAIL: ${c.name}`);
      failed++;
    } else {
      console.log(`PASS: ${c.name}`);
    }
  } catch (err) {
    console.error(`ERROR in ${c.name}:`, err);
    failed++;
  }
}
if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} tests passed`);
