// lib/ai/tools/format-tool-result.test.ts
//
// Throwaway test for formatToolResult. Mirrors the no-test-framework
// rule (AGENTS.md); cases[] + check pattern.
//
// Run: npx tsx lib/ai/tools/format-tool-result.test.ts

import { formatToolResult } from './format-tool-result';

type Case = {
  name: string;
  toolName: string;
  state: 'in_progress' | 'success' | 'error';
  args: unknown;
  result: unknown;
  expectContains?: string;
  expectEquals?: string;
  check: (out: string) => boolean;
};

const cases: Case[] = [
  // ── create_note ──
  {
    name: 'create_note success → contains title',
    toolName: 'create_note',
    state: 'success',
    args: { title: 'My new note', content: 'body' },
    result: { ok: true, noteId: 'abc123', title: 'My new note' },
    check: (out) => out.includes('My new note'),
  },
  {
    name: 'create_note error → contains "失败"',
    toolName: 'create_note',
    state: 'error',
    args: { title: 'x', content: 'y' },
    result: { ok: false, error: 'create_failed', message: 'db locked' },
    check: (out) => out.includes('失败') && out.includes('db locked'),
  },
  {
    name: 'create_note in_progress → "创建中"',
    toolName: 'create_note',
    state: 'in_progress',
    args: { title: 'x', content: 'y' },
    result: undefined,
    check: (out) => out.includes('创建'),
  },
  // ── read_note by ID ──
  {
    name: 'read_note by ID success → contains note title',
    toolName: 'read_note',
    state: 'success',
    args: { noteId: 'abc123' },
    result: {
      ok: true,
      note: { id: 'abc123', title: 'Found note', preview: '...', tags: [], summary: null, summaryState: 'none', updatedAt: 0, createdAt: 0, contentJson: { type: 'doc' }, contentText: '' },
    },
    check: (out) => out.includes('Found note'),
  },
  {
    name: 'read_note by ID miss → "不存在"',
    toolName: 'read_note',
    state: 'error',
    args: { noteId: 'missing' },
    result: { ok: false, error: 'note_not_found', noteId: 'missing' },
    check: (out) => out.includes('不存在'),
  },
  // ── read_note by query ──
  {
    name: 'read_note by query with results → contains count',
    toolName: 'read_note',
    state: 'success',
    args: { query: 'database' },
    result: {
      ok: true,
      results: [
        { id: 'a', title: 'A', preview: '...', tags: [], updatedAt: 0, createdAt: 0 },
        { id: 'b', title: 'B', preview: '...', tags: [], updatedAt: 0, createdAt: 0 },
        { id: 'c', title: 'C', preview: '...', tags: [], updatedAt: 0, createdAt: 0 },
      ],
    },
    check: (out) => out.includes('3'),
  },
  {
    name: 'read_note by query zero results → "没有"',
    toolName: 'read_note',
    state: 'success',
    args: { query: 'nothing matches' },
    result: { ok: true, results: [] },
    check: (out) => out.includes('没有'),
  },
  {
    name: 'read_note in_progress → "搜索中"',
    toolName: 'read_note',
    state: 'in_progress',
    args: { query: 'x' },
    result: undefined,
    check: (out) => out.includes('搜索') || out.includes('读') || out.includes('查找'),
  },
];

let failed = 0;
(async () => {
  for (const c of cases) {
    try {
      const out = formatToolResult(c.toolName, c.state, c.args, c.result);
      if (!c.check(out)) {
        console.error(`FAIL: ${c.name}`);
        console.error(`  got: "${out}"`);
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
})();