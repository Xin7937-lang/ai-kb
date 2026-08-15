// lib/ai/tools/rate-limit.test.ts
//
// Throwaway unit test for makeRateLimiter + withRateLimit. Mirrors
// the no-test-framework rule (AGENTS.md); cases[] + check pattern.
//
// Run: npx tsx lib/ai/tools/rate-limit.test.ts

import {
  TOOL_LIMIT_EXCEEDED_CODE,
  TOOL_LIMIT_EXCEEDED_MESSAGE,
  makeRateLimiter,
  withRateLimit,
} from './rate-limit';
// Local fixture type mirroring Vercel AI SDK's PromiseLike execute
// signature so the wrapper's generics are inferred end-to-end.
type Tool = {
  execute: (...args: unknown[]) => PromiseLike<string>;
};

type Case = {
  name: string;
  check: () => boolean;
};

let independentFirst: number | null = null;
let independentSecond: number | null = null;
let firstResult: unknown = null;
let secondResult: unknown = null;
let thirdResult: unknown = null;
let overflowResult: unknown = null;
let overflowHasMessage: boolean | null = null;
let overflowHasCorrectCode: boolean | null = null;
let innerCallCountAfterAllowed: number | null = null;
let innerCallCountAfterOverflow: number | null = null;
let resetCountOnFreshLimiter: number | null = null;

async function main(): Promise<void> {
  // Independent limiters do not share state.
  const lA = makeRateLimiter(5);
  const lB = makeRateLimiter(2);
  independentFirst = lA.increment();
  independentSecond = lB.increment();

  // withRateLimit: N succeed, N+1 fails.
  const limiter = makeRateLimiter(3);
  let innerCalls = 0;
  const tool: Tool = {
    execute: (..._args: unknown[]) => {
      innerCalls += 1;
      return Promise.resolve(`inner-${innerCalls}`);
    },
  };
  const wrapped = withRateLimit(tool, limiter);
  firstResult = await wrapped.execute();
  secondResult = await wrapped.execute();
  thirdResult = await wrapped.execute();
  innerCallCountAfterAllowed = innerCalls;
  overflowResult = await wrapped.execute();
  innerCallCountAfterOverflow = innerCalls;

  // Overflow payload includes both error code and human message.
  if (typeof overflowResult === 'object' && overflowResult !== null) {
    const o = overflowResult as { ok?: unknown; error?: unknown; message?: unknown };
    overflowHasCorrectCode = o.error === TOOL_LIMIT_EXCEEDED_CODE;
    overflowHasMessage = typeof o.message === 'string' && o.message.length > 0;
  }

  // Cap reset across "turns": a fresh limiter starts counting at 1.
  const fresh = makeRateLimiter(3);
  fresh.increment(); // first call on the fresh limiter
  fresh.increment(); // saturates fresh limiter
  fresh.increment(); // overflow call
  const freshAfterSaturation = makeRateLimiter(3);
  resetCountOnFreshLimiter = freshAfterSaturation.increment();

  const cases: Case[] = [
    // makeRateLimiter shape
    {
      name: 'first increment returns 1',
      check: () => independentFirst === 1,
    },
    {
      name: 'independent limiters do not share state',
      check: () => independentSecond === 1,
    },

    // withRateLimit happy path
    {
      name: 'call 1 → inner execute result',
      check: () => firstResult === 'inner-1',
    },
    {
      name: 'call 2 → inner execute result',
      check: () => secondResult === 'inner-2',
    },
    {
      name: 'call 3 (last allowed) → inner execute result',
      check: () => thirdResult === 'inner-3',
    },

    // withRateLimit overflow
    {
      name: 'call 4 (over cap) → ok:false',
      check: () => {
        if (typeof overflowResult !== 'object' || overflowResult === null) return false;
        return (overflowResult as { ok?: unknown }).ok === false;
      },
    },
    {
      name: 'overflow payload carries error code "tool_limit_exceeded"',
      check: () => overflowHasCorrectCode === true,
    },
    {
      name: 'overflow payload carries human-readable message',
      check: () => overflowHasMessage === true,
    },
    {
      name: 'inner execute NOT called when over cap',
      check: () =>
        innerCallCountAfterAllowed === 3 &&
        innerCallCountAfterOverflow === 3,
    },

    // Cap reset (F5): a fresh limiter starts at 1, not from the old
    // limiter's count. This is what makes the cap reset between turns.
    {
      name: 'fresh limiter after saturation starts at 1',
      check: () => resetCountOnFreshLimiter === 1,
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