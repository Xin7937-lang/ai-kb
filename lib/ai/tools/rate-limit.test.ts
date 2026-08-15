// lib/ai/tools/rate-limit.test.ts
//
// Throwaway unit test for makeRateLimiter + withRateLimit. Mirrors
// the no-test-framework rule (AGENTS.md); cases[] + check pattern.
//
// Run: npx tsx lib/ai/tools/rate-limit.test.ts

import { makeRateLimiter, withRateLimit } from './rate-limit';

type Case = {
  name: string;
  check: () => boolean;
};

let independent1: number | null = null;
let independent2: number | null = null;
let firstCount: number | null = null;
let ok1: unknown = null;
let ok2: unknown = null;
let ok3: unknown = null;
let over4: unknown = null;
let originalCalledTimes = 0;
let stillCalledAfterOver: number | null = null;

async function main(): Promise<void> {
  // Independent limiters do not share state
  const lA = makeRateLimiter(5);
  const lB = makeRateLimiter(2);
  independent1 = lA.increment();
  independent2 = lB.increment();
  firstCount = lA.increment(); // second call on lA

  // withRateLimit: N succeed, N+1 fails
  const limiter = makeRateLimiter(3);
  let innerCalls = 0;
  const tool = {
    execute: async () => {
      innerCalls += 1;
      return `inner-${innerCalls}`;
    },
  };
  const wrapped = withRateLimit(tool, limiter);
  ok1 = await wrapped.execute();
  ok2 = await wrapped.execute();
  ok3 = await wrapped.execute();
  over4 = await wrapped.execute();
  originalCalledTimes = innerCalls;
  stillCalledAfterOver = innerCalls; // should equal 3 — the inner is NOT called on overflow

  const cases: Case[] = [
    // makeRateLimiter
    {
      name: 'first increment returns 1',
      check: () => independent1 === 1,
    },
    {
      name: 'second increment on same limiter returns 2',
      check: () => firstCount === 2,
    },
    {
      name: 'independent limiters do not share state',
      check: () => independent2 === 1,
    },

    // withRateLimit happy path
    {
      name: 'call 1 → inner execute result',
      check: () => ok1 === 'inner-1',
    },
    {
      name: 'call 2 → inner execute result',
      check: () => ok2 === 'inner-2',
    },
    {
      name: 'call 3 (last allowed) → inner execute result',
      check: () => ok3 === 'inner-3',
    },

    // withRateLimit overflow
    {
      name: 'call 4 (over cap) → {ok:false, error:"tool_limit_exceeded"}',
      check: () => {
        if (typeof over4 !== 'object' || over4 === null) return false;
        const o = over4 as { ok?: unknown; error?: unknown };
        return o.ok === false && o.error === 'tool_limit_exceeded';
      },
    },
    {
      name: 'inner execute NOT called when over cap',
      check: () => originalCalledTimes === 3 && stillCalledAfterOver === 3,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
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
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(1);
});