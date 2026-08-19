// lib/ai/tools/agent-audit.ts
//
// Two-phase audit wrapper for every agent tool execution.
//
// Lifecycle of a single agent action:
//   1. INSERT pending row (actionId generated here).
//   2. Run the tool's actual work.
//      - on success → markAgentActionResult with 'ok' or
//        'ok_with_embedding_disabled' + target_note_id.
//      - on work() returning ok=false → markAgentActionResult with
//        'error' + error_message.
//      - on work() throwing → markAgentActionResult with 'error' +
//        error_message.
//   3. Return a structured result to the caller.
//
// The pending row exists even if the process crashes mid-tool — future
// recovery code can find incomplete actions by scanning result='pending'.

import { nanoid } from 'nanoid';

import { getDb } from '@/lib/db/client';

export type AgentAuditResultCode =
  | 'pending'
  | 'ok'
  | 'ok_with_embedding_disabled'
  | 'error';

export type AgentAuditContext = {
  conversationId?: string | null;
};

export type AgentActionRow = {
  id: string;
  conversationId: string | null;
  actionType: string;
  targetNoteId: string | null;
  paramsJson: string | null;
  result: AgentAuditResultCode;
  errorMessage: string | null;
  createdAt: number;
};

export type ListAgentActionsOpts = {
  limit?: number;
  offset?: number;
  conversationId?: string;
};

/**
 * Read agent_actions rows newest-first. Used by the audit-history UI
 * (ticket 04). Pure DB read; the HTTP layer wraps it with auth +
 * query parsing.
 */
export function listAgentActions(
  opts: ListAgentActionsOpts = {},
): AgentActionRow[] {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const conversationId = opts.conversationId?.trim();

  const where: string[] = [];
  const params: unknown[] = [];
  if (conversationId) {
    where.push('conversation_id = ?');
    params.push(conversationId);
  }

  let sql =
    `SELECT id, conversation_id, action_type, target_note_id,
            params_json, result, error_message, created_at
       FROM agent_actions`;
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = getDb()
    .prepare<unknown[], {
      id: string;
      conversation_id: string | null;
      action_type: string;
      target_note_id: string | null;
      params_json: string | null;
      result: AgentAuditResultCode;
      error_message: string | null;
      created_at: number;
    }>(sql)
    .all(...params);

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    actionType: r.action_type,
    targetNoteId: r.target_note_id,
    paramsJson: r.params_json,
    result: r.result,
    errorMessage: r.error_message,
    createdAt: r.created_at,
  }));
}

export type AgentWorkResult<TPayload = undefined> =
  | {
      ok: true;
      targetNoteId: string | null;
      result: 'ok' | 'ok_with_embedding_disabled';
      payload: TPayload;
    }
  | {
      ok: false;
      error?: string;
      message: string;
    };

export type AgentAuditOutcome<TPayload = undefined> =
  | {
      ok: true;
      actionId: string;
      targetNoteId: string | null;
      payload: TPayload;
    }
  | { ok: false; actionId: string; error: string; message: string };

// Marks an existing agent_action row as terminal. Single UPDATE
// that always writes `result` and conditionally writes the action-
// specific column (`target_note_id` for ok-ish, `error_message` for
// errors) using COALESCE so the other column keeps its existing
// value. Avoids the previous if/else split that duplicated the
// prepared-statement shape.
function markAgentActionResult(
  actionId: string,
  code: AgentAuditResultCode,
  detail: { targetNoteId: string | null; errorMessage: string | null },
): void {
  getDb()
    .prepare(
      `UPDATE agent_actions
         SET result = ?,
             target_note_id = COALESCE(?, target_note_id),
             error_message = COALESCE(?, error_message)
       WHERE id = ?`,
    )
    .run(code, detail.targetNoteId, detail.errorMessage, actionId);
}

export async function withAgentAudit(
  actionType: string,
  paramsJson: string,
  work: () => Promise<AgentWorkResult>,
  context?: AgentAuditContext,
): Promise<AgentAuditOutcome>;
export async function withAgentAudit<TPayload>(
  actionType: string,
  paramsJson: string,
  work: () => Promise<AgentWorkResult<TPayload>>,
  context?: AgentAuditContext,
): Promise<AgentAuditOutcome<TPayload>>;
export async function withAgentAudit<TPayload>(
  actionType: string,
  paramsJson: string,
  work: () => Promise<AgentWorkResult<TPayload>>,
  context: AgentAuditContext = {},
): Promise<AgentAuditOutcome<TPayload>> {
  const actionId = nanoid(12);
  const createdAt = Date.now();
  const conversationId = context.conversationId?.trim() || null;

  getDb()
    .prepare(
      `INSERT INTO agent_actions
         (id, conversation_id, action_type, params_json, result, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
    .run(actionId, conversationId, actionType, paramsJson, createdAt);

  try {
    const workResult = await work();
    if (workResult.ok) {
      markAgentActionResult(actionId, workResult.result, {
        targetNoteId: workResult.targetNoteId,
        errorMessage: null,
      });
      return {
        ok: true,
        actionId,
        targetNoteId: workResult.targetNoteId,
        payload: workResult.payload,
      };
    }
    markAgentActionResult(actionId, 'error', {
      targetNoteId: null,
      errorMessage: workResult.message,
    });
    // Surface the inner work() error code (e.g. 'note_not_found') so
    // the tool response has a specific category rather than the
    // generic 'work_failed' wrapper.
    return {
      ok: false,
      actionId,
      error: workResult.error ?? 'work_failed',
      message: workResult.message,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markAgentActionResult(actionId, 'error', {
      targetNoteId: null,
      errorMessage: msg,
    });
    return { ok: false, actionId, error: 'work_threw', message: msg };
  }
}

export function serializeAgentToolParams(value: unknown): string {
  return JSON.stringify(value) ?? '{}';
}

export async function recordAgentToolFailure(
  actionType: string,
  paramsJson: string,
  error: string,
  message: string,
  context: AgentAuditContext = {},
): Promise<{ ok: false; error: string; message: string }> {
  const outcome = await withAgentAudit(
    actionType,
    paramsJson,
    async () => ({
      ok: false as const,
      error,
      message,
    }),
    context,
  );
  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.error,
      message: outcome.message,
    };
  }

  console.error(
    '[agent-audit] rejection audit unexpectedly completed successfully',
  );
  throw new Error('agent_audit_rejection_unexpected_success');
}
