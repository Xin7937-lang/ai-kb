// lib/ai/tools/rate-limit.ts
//
// Per-turn tool-call rate limiter (ticket 05). Wraps any tool with
// an `execute` method so that the (max+1)-th call returns a
// `{ ok: false, error: TOOL_LIMIT_EXCEEDED_CODE, message: '...' }`
// payload without invoking the inner execute. State lives in a
// closure so each fresh limiter starts at zero; buildToolsConfig()
// creates one per streamChat invocation (= per turn), so the cap
// resets naturally.
//
// The wrapper preserves the input tool's other fields (description,
// parameters, etc.) via the spread; only `execute` is overridden.
// The constraint uses `any[]` for variance plumbing only — the
// data still flows through the typed `execute` signature. The call
// site can assign the return value to `Record<string, CoreTool>`
// without an external cast.

import {
  recordAgentToolFailure,
  serializeAgentToolParams,
  type AgentAuditContext,
} from './agent-audit';

export const TOOL_LIMIT_EXCEEDED_CODE = 'tool_limit_exceeded';
export const TOOL_LIMIT_EXCEEDED_MESSAGE = '工具调用次数超过限制';

export type ToolLimitError = {
  ok: false;
  error: typeof TOOL_LIMIT_EXCEEDED_CODE;
  message: string;
};

export type RateLimiter = {
  /**
   * Returns the number of calls recorded so far, INCLUDING this one.
   * For overflow calls, the inner execute is not invoked — but the
   * count still advances so callers can detect runaway loops.
   */
  increment(): number;
  /** Maximum allowed calls (inclusive). */
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

// Permissive constraint (any[]) for variance. Real execute args still
// flow through typed signature on the wrapped call site.
type AnyExecutableTool = {
  execute: (...args: any[]) => any;
};

export function withRateLimit<T extends AnyExecutableTool>(
  tool: T,
  limiter: RateLimiter,
  audit?: {
    actionType: string;
    context?: AgentAuditContext;
  },
): T {
  const inner = tool.execute.bind(tool) as (...args: any[]) => any;
  return {
    ...tool,
    execute: (async (...args: any[]) => {
      const callNum = limiter.increment();
      if (callNum > limiter.max) {
        if (audit) {
          return recordAgentToolFailure(
            audit.actionType,
            serializeAgentToolParams(args[0] ?? {}),
            TOOL_LIMIT_EXCEEDED_CODE,
            TOOL_LIMIT_EXCEEDED_MESSAGE,
            audit.context,
          );
        }
        return {
          ok: false,
          error: TOOL_LIMIT_EXCEEDED_CODE,
          message: TOOL_LIMIT_EXCEEDED_MESSAGE,
        };
      }
      return inner(...args);
    }) as T['execute'],
  } as T;
}
