// lib/ai/tools/read_note.ts
//
// read_note tool: lets the /chat agent look up notes either by ID or
// by keyword query. Read-only — no audit wrapper (the agent_actions
// table is reserved for write actions; read calls don't need a trail).
//
// Schema enforces "either noteId or query, not neither, not both
// empty". The LLM gets a clear refinement message if it forgets to
// provide one of them, so it can self-correct.

import { tool } from 'ai';
import { z } from 'zod';

import { getNote, searchNotesFts } from '@/lib/notes/queries';

export const readNoteTool = tool({
  description:
    'Read a note by its unique ID, or search for notes by keyword query. ' +
    'Use noteId when you already know which note to reference (from a prior ' +
    'read_note result, a citation in a prior answer, or the user explicitly ' +
    'naming a note). Use query when looking for notes about a topic. ' +
    'Provide exactly one of noteId or query — not both, not neither. ' +
    'Returns the full note (by ID) or a list of search-result summaries (by query).',
  parameters: z
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
    .refine(
      (v) => Boolean(v.noteId) || Boolean(v.query),
      { message: 'either noteId or query must be provided' },
    ),
  execute: async ({ noteId, query }) => {
    if (noteId) {
      const note = getNote(noteId);
      if (!note) {
        return { ok: false, error: 'note_not_found', noteId };
      }
      return { ok: true, note };
    }
    if (query) {
      const results = searchNotesFts(query);
      return { ok: true, results };
    }
    // Should be unreachable — refinement would have rejected the input —
    // but kept as a defensive fallback so we never return undefined.
    return { ok: false, error: 'no_input' };
  },
});