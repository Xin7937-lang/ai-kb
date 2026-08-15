// lib/ai/tools/agent-audit.ts
//
// Two-phase audit wrapper for agent tool calls. Used by every tool
// (currently create_note; stage 2 will add edit_note / delete_note).
//
// Lifecycle of a single agent action:
//   1. INSERT pending row (actionId generated here).
//   2. Run the tool's actual work.
//      - on success → UPDATE row to result='ok' (or 'ok_with_embedding_disabled')
//        + target_note_id.
//      - on work() returning ok=false → UPDATE to result='error' + error_message.
//      - on work() throwing → UPDATE to result='error' + error_message.
//   3. Return a structured result to the caller.
//
// The pending row exists even if the process crashes mid-tool — future
// recovery code can find incomplete actions by scanning result='pending'.

import { nanoid } from 'nanoid';

import { getDb } from '@/lib/db/client';

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
      getDb()
        .prepare(
          `UPDATE agent_actions
             SET result = ?, target_note_id = ?
           WHERE id = ?`,
        )
        .run(workResult.result, workResult.targetNoteId, actionId);
      return { ok: true, actionId, targetNoteId: workResult.targetNoteId };
    }
    // Work returned ok=false — still treat as audit-recorded failure.
    getDb()
      .prepare(
        `UPDATE agent_actions
           SET result = 'error', error_message = ?
         WHERE id = ?`,
      )
      .run(workResult.message, actionId);
    return {
      ok: false,
      actionId,
      error: 'work_failed',
      message: workResult.message,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    getDb()
      .prepare(
        `UPDATE agent_actions
           SET result = 'error', error_message = ?
         WHERE id = ?`,
      )
      .run(msg, actionId);
    return { ok: false, actionId, error: 'work_threw', message: msg };
  }
}