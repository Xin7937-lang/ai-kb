// lib/ai/tools/agent-audit.ts
//
// Two-phase audit wrapper for agent tool *write* operations. Read-only
// tools (read_note) deliberately opt out — they don't mutate state.
//
// Currently used by create_note; stage 2 will add edit_note / delete_note.
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
  | 'ok'
  | 'ok_with_embedding_disabled'
  | 'error';

export type AgentWorkResult =
  | {
      ok: true;
      targetNoteId: string | null;
      result: 'ok' | 'ok_with_embedding_disabled';
    }
  | {
      ok: false;
      message: string;
    };

export type AgentAuditOutcome =
  | { ok: true; actionId: string; targetNoteId: string | null }
  | { ok: false; actionId: string; error: string; message: string };

// Marks an existing agent_action row as terminal. On 'ok' /
// 'ok_with_embedding_disabled' we also persist the target_note_id
// (may be null for actions that don't touch a specific note). On
// 'error' we persist the error_message instead.
function markAgentActionResult(
  actionId: string,
  code: AgentAuditResultCode,
  detail: { targetNoteId: string | null } | { errorMessage: string },
): void {
  if (code === 'error') {
    getDb()
      .prepare(
        `UPDATE agent_actions
           SET result = ?, error_message = ?
         WHERE id = ?`,
      )
      .run(code, (detail as { errorMessage: string }).errorMessage, actionId);
    return;
  }
  getDb()
    .prepare(
      `UPDATE agent_actions
         SET result = ?, target_note_id = ?
       WHERE id = ?`,
    )
    .run(code, (detail as { targetNoteId: string | null }).targetNoteId, actionId);
}

export async function withAgentAudit(
  actionType: string,
  paramsJson: string,
  work: () => Promise<AgentWorkResult>,
): Promise<AgentAuditOutcome> {
  const actionId = nanoid(12);
  const createdAt = Date.now();

  getDb()
    .prepare(
      `INSERT INTO agent_actions
         (id, action_type, params_json, result, created_at)
       VALUES (?, ?, ?, 'pending', ?)`,
    )
    .run(actionId, actionType, paramsJson, createdAt);

  try {
    const workResult = await work();
    if (workResult.ok) {
      markAgentActionResult(actionId, workResult.result, {
        targetNoteId: workResult.targetNoteId,
      });
      return { ok: true, actionId, targetNoteId: workResult.targetNoteId };
    }
    markAgentActionResult(actionId, 'error', {
      errorMessage: workResult.message,
    });
    return {
      ok: false,
      actionId,
      error: 'work_failed',
      message: workResult.message,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markAgentActionResult(actionId, 'error', { errorMessage: msg });
    return { ok: false, actionId, error: 'work_threw', message: msg };
  }
}