// lib/ai/embeddings-mock.test.ts
//
// Throwaway test runner for the mock embedder helper. Mirrors the
// project's "no unit-test framework" rule (AGENTS.md); see
// lib/notes/chunk.test.ts for the reference pattern.
//
// Run: npx tsx lib/ai/embeddings-mock.test.ts
//
// Exits 0 on success, 1 on any failed assertion.

import { mockEmbedTexts } from './embeddings-mock';

// 2048 must match EMBEDDING_DIMENSION in lib/ai/embeddings.ts.
// Kept as a literal here so the test runner does not depend on the
// env-loaded embeddings module.
const EXPECTED_DIM = 2048;

type Case = {
  name: string;
  texts: string[];
  check: (out: number[][]) => boolean | Promise<boolean>;
};

function isVector(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'number');
}

function eqVector(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const cases: Case[] = [
  {
    name: 'empty texts → empty output',
    texts: [],
    check: (out) => Array.isArray(out) && out.length === 0,
  },
  {
    name: 'single text → single 2048-dim vector',
    texts: ['hello world'],
    check: (out) =>
      out.length === 1 && isVector(out[0]) && out[0].length === EXPECTED_DIM,
  },
  {
    name: 'three texts → three 2048-dim vectors',
    texts: ['foo', 'bar', 'baz'],
    check: (out) =>
      out.length === 3 &&
      out.every((v) => isVector(v) && v.length === EXPECTED_DIM),
  },
  {
    name: 'same texts twice → identical vectors',
    texts: ['repeatable', 'stable'],
    check: async (first) => {
      const second = await mockEmbedTexts(['repeatable', 'stable']);
      return first.length === second.length && first.every((v, i) => eqVector(v, second[i]));
    },
  },
  {
    name: 'different texts → at least one element differs',
    texts: ['alpha'],
    check: async (a) => {
      const b = await mockEmbedTexts(['beta']);
      return a[0].some((x, j) => x !== b[0][j]);
    },
  },
];

let failed = 0;
(async () => {
  for (const c of cases) {
    try {
      const out = await mockEmbedTexts(c.texts);
      if (!(await c.check(out))) {
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

  // Force-failure env-flag tests need direct env manipulation, so they
  // live outside the cases[] loop (chunk.test.ts has no equivalent).
  const prevFlag = process.env.EMBEDDING_MOCK_FORCE_FAIL;
  try {
    process.env.EMBEDDING_MOCK_FORCE_FAIL = '1';
    try {
      await mockEmbedTexts(['x']);
      console.error('FAIL: force-failure env flag → throws');
      failed++;
    } catch {
      console.log('PASS: force-failure env flag → throws');
    }

    delete process.env.EMBEDDING_MOCK_FORCE_FAIL;
    try {
      await mockEmbedTexts(['x']);
      console.log('PASS: no force-failure env flag → does not throw');
    } catch {
      console.error('FAIL: no force-failure env flag → does not throw');
      failed++;
    }
  } finally {
    if (prevFlag === undefined) {
      delete process.env.EMBEDDING_MOCK_FORCE_FAIL;
    } else {
      process.env.EMBEDDING_MOCK_FORCE_FAIL = prevFlag;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length + 2} tests passed`);
})();