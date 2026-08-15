// lib/ai/tools/rate-limit.ts
//
// Per-turn tool-call rate limiter (ticket 05). Wraps any tool with
// an `execute` method so that the (max+1)-th call returns a
// `{ ok: false, error: 'tool_limit_exceeded' }` payload without
// invoking the inner execute. State lives in a closure so each
// fresh limiter starts at zero; buildToolsConfig() creates one per
// streamChat invocation (= per turn), so the cap resets naturally.
//
// The wrapper is generic over the tool's execute args so it composes
// with any Vercel AI SDK `CoreTool` (whose execute has typed args).

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

export type ExecutableTool<TArgs extends unknown[], TResult> = {
  execute: (...args: TArgs) => PromiseLike<TResult>;
};

export function withRateLimit<TArgs extends unknown[], TResult>(
  tool: ExecutableTool<TArgs, TResult>,
  limiter: RateLimiter,
): ExecutableTool<TArgs, TResult | { ok: false; error: 'tool_limit_exceeded' }> {
  const inner = tool.execute.bind(tool);
  return {
    execute: async (...args: TArgs) => {
      const callNum = limiter.increment();
      if (callNum > limiter.max) {
        return { ok: false, error: 'tool_limit_exceeded' };
      }
      return inner(...args);
    },
  };
}