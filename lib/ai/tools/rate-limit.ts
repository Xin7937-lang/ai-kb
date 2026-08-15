// lib/ai/tools/rate-limit.ts
//
// Per-turn tool-call rate limiter (ticket 05). Wraps any tool with
// an `execute` method so that the (max+1)-th call returns a
// `{ ok: false, error: 'tool_limit_exceeded' }` payload without
// invoking the inner execute. State lives in a closure so each
// fresh limiter starts at zero; buildToolsConfig() creates one per
// streamChat invocation (= per turn), so the cap resets naturally.

export type RateLimiter = {
  /** Returns the new count after this call. */
  increment(): number;
  /** Maximum allowed calls. */
  readonly max: number;
};

export function makeRateLimiter(max: number): RateLimiter {
  let count = 0;
  return {
    increment() {
      count += 1;
      return count;
    },
    max,
  };
}

// The constraint on the tool is intentionally loose — we only need
// the `execute` shape — so this helper composes with anything that
// satisfies the Vercel AI SDK `Tool` contract plus our own helpers.
type ExecutableTool = {
  execute: (...args: unknown[]) => Promise<unknown>;
};

export function withRateLimit<T extends ExecutableTool>(
  tool: T,
  limiter: RateLimiter,
): T {
  const originalExecute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (...args: unknown[]): Promise<unknown> => {
      const callNum = limiter.increment();
      if (callNum > limiter.max) {
        return { ok: false, error: 'tool_limit_exceeded' };
      }
      return originalExecute(...args);
    },
  };
}