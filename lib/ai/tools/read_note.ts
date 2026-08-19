// lib/ai/tools/read_note.ts
//
// read_note tool: lets the /chat agent look up notes either by ID or
// by keyword query. Every invocation is audited so reads, misses, and
// failures are visible alongside write actions.
//
// Schema enforces "either noteId or query, not neither, not both
// empty". The LLM gets a clear refinement message if it forgets to
// provide one of them, so it can self-correct.

import { tool } from 'ai';
import { z } from 'zod';

import {
  getNote,
  searchNotesFts,
  type FtsSearchResult,
  type NoteFull,
} from '@/lib/notes/queries';

import {
  recordAgentToolFailure,
  serializeAgentToolParams,
  type AgentAuditContext,
  type AgentWorkResult,
  withAgentAudit,
} from './agent-audit';

const readNoteParamsSchema = z
  .object({
    noteId: z
      .string()
      .min(1, 'noteId must not be empty')
      .optional(),
    query: z
      .string()
      .min(1, 'query must not be empty')
      .optional(),
  })
  .refine((v) => Boolean(v.noteId) || Boolean(v.query), {
    message: 'either noteId or query must be provided',
  });

type ReadNotePayload =
  | { ok: true; note: NoteFull }
  | { ok: true; results: FtsSearchResult[] };

export function makeReadNoteTool(context: AgentAuditContext = {}) {
  return tool({
    description:
      'Read a note by its unique ID, or search for notes by keyword query. ' +
      'Use noteId when you already know which note to reference (from a prior ' +
      'read_note result, a citation in a prior answer, or the user explicitly ' +
      'naming a note). Use query when looking for notes about a topic. ' +
      'Provide at least one of noteId or query. If both are provided, ' +
      'noteId takes precedence and query is ignored. Returns the full ' +
      'note (by ID) or a list of search-result summaries (by query).',
    parameters: readNoteParamsSchema,
    execute: async (rawArgs: unknown) => {
      const parsed = readNoteParamsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return recordAgentToolFailure(
          'read_note',
          serializeAgentToolParams(rawArgs),
          'invalid_arguments',
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
          context,
        );
      }

      const { noteId, query } = parsed.data;
      const outcome = await withAgentAudit<ReadNotePayload>(
        'read_note',
        serializeAgentToolParams({ noteId, query }),
        async (): Promise<AgentWorkResult<ReadNotePayload>> => {
          if (noteId) {
            const note = getNote(noteId);
            if (!note) {
              return {
                ok: false,
                error: 'note_not_found',
                message: `note_not_found: '${noteId}' not found or deleted`,
              };
            }
            return {
              ok: true,
              targetNoteId: note.id,
              result: 'ok',
              payload: { ok: true, note },
            };
          }

          // The schema guarantees query is present in this branch.
          const results = searchNotesFts(query ?? '');
          return {
            ok: true,
            targetNoteId: null,
            result: 'ok',
            payload: { ok: true, results },
          };
        },
        context,
      );

      if (outcome.ok) return outcome.payload;
      return {
        ok: false,
        error: outcome.error,
        message: outcome.message,
        ...(noteId ? { noteId } : {}),
      };
    },
  });
}

export const readNoteTool = makeReadNoteTool();