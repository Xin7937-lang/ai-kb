// lib/ai/tools/edit_note.ts
//
// edit_note tool: lets the /chat agent modify an existing note by id.
// Supports four kinds of edits in a single tool:
//   - title: replace the title
//   - content: replace content_text (and the underlying TipTap doc)
//   - appendContent: append to content_text with a blank-line separator
//   - tags: replace the full tag set (not merged)
//
// content and appendContent are mutually exclusive: the LLM picks one
// per call. At least one of {title, content, appendContent, tags} must
// be present in the updates object (Zod refinement).
//
// Soft-deleted (deleted_at IS NOT NULL) or missing notes return
// {ok:false, error:'note_not_found'} so the model gets a clear signal.
//
// Zod schema enforces hard limits per AGENTS.md style — same caps
// as the API route validation: title ≤ 200, content/appendContent
// ≤ 50000, tags ≤ 32 entries.

import { tool } from 'ai';
import { z } from 'zod';

import { getNote, updateNote } from '@/lib/notes/queries';

import { withAgentAudit } from './agent-audit';

const updatesSchema = z
  .object({
    title: z
      .string()
      .min(1, 'title must not be empty')
      .max(200, 'title must be at most 200 characters')
      .optional(),
    content: z
      .string()
      .min(1, 'content must not be empty')
      .max(50000, 'content must be at most 50000 characters')
      .optional(),
    appendContent: z
      .string()
      .min(1, 'appendContent must not be empty')
      .max(50000, 'appendContent must be at most 50000 characters')
      .optional(),
    tags: z
      .array(
        z
          .string()
          .min(1)
          .max(64, 'each tag must be at most 64 characters'),
      )
      .max(32, 'tags must be at most 32 entries')
      .optional(),
  })
  .refine(
    (u) =>
      u.title !== undefined ||
      u.content !== undefined ||
      u.appendContent !== undefined ||
      u.tags !== undefined,
    {
      message:
        'updates must include at least one of title / content / appendContent / tags',
    },
  )
  .refine(
    (u) => !(u.content !== undefined && u.appendContent !== undefined),
    {
      message: 'content and appendContent are mutually exclusive — pick one',
      path: ['appendContent'],
    },
  );

const editNoteParamsSchema = z.object({
  noteId: z
    .string()
    .min(1, 'noteId must not be empty')
    .max(64, 'noteId must be at most 64 characters'),
  updates: updatesSchema,
});

export const editNoteTool = tool({
  description:
    'Edit an existing note by id. Apply one or more updates in a single call: title (replace), content (replace content_text and re-chunk), appendContent (append with a blank-line separator), or tags (replace the full tag set). content and appendContent are mutually exclusive. The note is re-embedded automatically so it stays searchable. Soft-deleted notes return note_not_found.',
  parameters: editNoteParamsSchema,
  execute: async (rawArgs: unknown) => {
    // Explicit parameter validation. The Vercel SDK's tool() wrapper
    // doesn't enforce the Zod schema when execute() is called directly
    // (only when called via useChat / streamText). We re-validate here
    // so the tool self-protects regardless of caller.
    const parsed = editNoteParamsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      // Don't audit schema violations — the LLM caller can self-correct.
      return {
        ok: false,
        error: 'invalid_arguments',
        message: parsed.error.issues
          .map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      };
    }
    const { noteId, updates } = parsed.data;

    // Extract the LLM-facing error code from the audit message when
    // the audit categorises the failure as work_failed / work_threw. The
    // inner work() callback's error code (e.g. 'note_not_found') is
    // captured in the work() result.error and surfaced via the
    // outcome.message; we re-pull the snake_case code out so the tool
    // response has a specific error rather than the generic 'work_failed'.
    function extractWorkError(message: string | undefined): string {
      if (!message) return 'unknown_error';
      const m = message.match(/'([a-z_]+)'/);
      if (m) return m[1];
      if (message.includes('note_not_found')) return 'note_not_found';
      return message.slice(0, 64);
    }

    const outcome = await withAgentAudit(
      'edit_note',
      JSON.stringify({ noteId, updates }),
      async () => {
        const existing = getNote(noteId);
        if (!existing) {
          // getNote already filters out soft-deleted, so this covers
          // both missing and deleted_at != null cases. The message
          // carries the error string so the audit row is searchable
          // by snake_case code; the tool re-extracts it for the
          // response.
          return {
            ok: false as const,
            error: 'note_not_found' as const,
            message: "note_not_found: '" + noteId + "' not found or deleted",
          };
        }

        // Resolve final content_text based on which content op the
        // caller picked. content replaces, appendContent appends with
        // a blank-line separator; the schema refinement guarantees
        // exactly one of the two is set (or neither, in which case
        // the existing content is preserved).
        let nextContentText: string | undefined;
        let nextContentJson: unknown | undefined;
        if (updates.content !== undefined) {
          nextContentText = updates.content;
          nextContentJson = {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: updates.content }],
              },
            ],
          };
        } else if (updates.appendContent !== undefined) {
          const sep = existing.contentText ? '\n\n' : '';
          nextContentText = existing.contentText + sep + updates.appendContent;
          nextContentJson = {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: nextContentText,
                  },
                ],
              },
            ],
          };
        }

        const updated = await updateNote(noteId, {
          title: updates.title,
          contentJson: nextContentJson as Parameters<
            typeof updateNote
          >[1]['contentJson'],
          contentText: nextContentText,
          tags: updates.tags,
        });
        if (!updated) {
          return {
            ok: false as const,
            error: 'note_not_found' as const,
            message: `note_not_found: '${noteId}' disappeared during update`,
          };
        }
        return {
          ok: true as const,
          targetNoteId: updated.id,
          result: (updated.embedded ? 'ok' : 'ok_with_embedding_disabled') as
            | 'ok'
            | 'ok_with_embedding_disabled',
        };
      },
    );

    // The audit wrapper categorises the failure as 'work_failed' or
    // 'work_threw', but the inner work() callback's specific error code
    // (e.g. 'note_not_found') is captured in the work() result.error and
    // threaded into outcome.error via the audit. For known LLM-facing
    // codes, surface the specific code in the tool response too.
    if (outcome.ok) {
      return {
        ok: true,
        noteId: outcome.targetNoteId,
        title: updates.title,
      };
    }
    const knownError =
      outcome.error === 'work_failed' || outcome.error === 'work_threw'
        ? extractWorkError(outcome.message)
        : outcome.error;
    return { ok: false, error: knownError, message: outcome.message };
  },
});
