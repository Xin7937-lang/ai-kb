// lib/ai/tools/batch-guard.ts
//
// Per-turn batch edit/delete guard. When the `agent_batch_edit_delete_enabled`
// setting is false (the default), the agent may execute at most one
// `edit_note` or `delete_note` call per `streamChat` turn. The 2nd+ call
// is rejected with a user-facing message and recorded as an error in
// `agent_actions`.
//
// Pattern mirrors `rate-limit.ts`: one shared counter per `buildToolsConfig()`
// call, and a wrapper that overrides only `execute`.

import { withAgentAudit } from './agent-audit';

export const BATCH_EDIT_DELETE_DISABLED_CODE =
  'batch_edit_delete_disabled';
export const BATCH_EDIT_DELETE_DISABLED_MESSAGE =
  '批量编辑/删除已禁用。同一轮对话中只能执行一次 edit_note 或 delete_note。' +
  '如需继续，请用户到「设置 → Agent」开启「允许批量编辑和删除笔记」开关。';

export type BatchEditDeleteCounter = {
  /**
   * Returns the number of edit/delete calls recorded so far, INCLUDING
   * this one. The counter is shared across `edit_note` and `delete_note`
   * within a single turn.
   */
  increment(): number;
};

export function makeBatchEditDeleteCounter(): BatchEditDeleteCounter {
  let count = 0;
  return {
    increment() {
      count += 1;
      return count;
    },
  };
}

// Permissive constraint (any[]) for variance, same rationale as rate-limit.ts.
type AnyExecutableTool = {
  execute: (...args: any[]) => any;
};

export function withBatchEditDeleteGuard<T extends AnyExecutableTool>(
  tool: T,
  counter: BatchEditDeleteCounter,
  enabled: boolean,
  actionType: string,
): T {
  const inner = tool.execute.bind(tool) as (...args: any[]) => any;
  return {
    ...tool,
    execute: (async (...args: any[]) => {
      const callNum = counter.increment();
      if (!enabled && callNum > 1) {
        const outcome = await withAgentAudit(
          actionType,
          JSON.stringify(args[0] ?? {}),
          async () => ({
            ok: false as const,
            error: BATCH_EDIT_DELETE_DISABLED_CODE,
            message: BATCH_EDIT_DELETE_DISABLED_MESSAGE,
          }),
        );
        if (!outcome.ok) {
          return {
            ok: false,
            error: outcome.error,
            message: outcome.message,
          };
        }
        // outcome.ok should be unreachable here because the audited work
        // always returns ok:false; fall back to a safe error payload.
        return {
          ok: false,
          error: BATCH_EDIT_DELETE_DISABLED_CODE,
          message: BATCH_EDIT_DELETE_DISABLED_MESSAGE,
        };
      }
      return inner(...args);
    }) as T['execute'],
  } as T;
}
