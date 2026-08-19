// lib/ai/tools/delete_note.ts
//
// delete_note tool: lets the /chat agent soft-delete an existing note by id.
// The row is kept (deleted_at set to current timestamp) so it can be
// recovered; list/get queries already filter out soft-deleted rows.
//
// Missing or already-soft-deleted notes return {ok:false,error:'note_not_found'}.

import { tool } from 'ai';
import { z } from 'zod';

import { softDeleteNote } from '@/lib/notes/queries';

import {
  recordAgentToolFailure,
  serializeAgentToolParams,
  type AgentAuditContext,
  withAgentAudit,
} from './agent-audit';

const deleteNoteParamsSchema = z.object({
  noteId: z
    .string()
    .min(1, 'noteId must not be empty')
    .max(64, 'noteId must be at most 64 characters'),
});

export function makeDeleteNoteTool(context: AgentAuditContext = {}) {
  return tool({
    description:
      'Delete an existing note by id. The note is soft-deleted (kept but hidden from lists and search). Returns note_not_found if the id does not exist or is already deleted.',
    parameters: deleteNoteParamsSchema,
    execute: async (rawArgs: unknown) => {
      const parsed = deleteNoteParamsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return recordAgentToolFailure(
          'delete_note',
          serializeAgentToolParams(rawArgs),
          'invalid_arguments',
          parsed.error.issues
            .map(
              (issue: z.ZodIssue) =>
                `${issue.path.join('.')}: ${issue.message}`,
            )
            .join('; '),
          context,
        );
      }
      const { noteId } = parsed.data;

      const outcome = await withAgentAudit(
        'delete_note',
        serializeAgentToolParams({ noteId }),
        async () => {
          const deleted = softDeleteNote(noteId);
          if (!deleted) {
            return {
              ok: false as const,
              error: 'note_not_found' as const,
              message: `note_not_found: '${noteId}' not found or already deleted`,
            };
          }
          return {
            ok: true as const,
            targetNoteId: noteId,
            result: 'ok' as const,
            payload: undefined,
          };
        },
        context,
      );

      if (outcome.ok) {
        return { ok: true, noteId: outcome.targetNoteId };
      }
      return {
        ok: false,
        error: outcome.error,
        message: outcome.message,
      };
    },
  });
}

export const deleteNoteTool = makeDeleteNoteTool();
