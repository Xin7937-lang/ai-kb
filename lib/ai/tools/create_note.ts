// lib/ai/tools/create_note.ts
//
// create_note tool: lets the /chat agent create a note on the user's
// behalf. The tool's execute() is a thin wrapper around the existing
// createNote() data-layer function, wrapped in withAgentAudit for the
// two-phase audit lifecycle.
//
// Zod schema enforces hard limits per AGENTS.md style (strict caps,
// no speculation) — title ≤ 200, content ≤ 50000.

import { tool } from 'ai';
import { z } from 'zod';
import type { JSONContent } from '@tiptap/react';

import { createNote } from '@/lib/notes/queries';

import {
  recordAgentToolFailure,
  serializeAgentToolParams,
  type AgentAuditContext,
  withAgentAudit,
} from './agent-audit';

// Wrap plain text into a minimal TipTap doc so the note renders
// sensibly in the existing editor.
function textToDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

const createNoteParamsSchema = z.object({
  title: z
    .string()
    .min(1, 'title must not be empty')
    .max(200, 'title must be at most 200 characters'),
  content: z
    .string()
    .min(1, 'content must not be empty')
    .max(50000, 'content must be at most 50000 characters'),
});

export function makeCreateNoteTool(context: AgentAuditContext = {}) {
  return tool({
    description:
      'Create a new note with the given title and content. Use this when the user asks you to save, capture, or write down something from the conversation. The note will appear in the main notes list and be searchable via RAG immediately.',
    parameters: createNoteParamsSchema,
    execute: async (rawArgs: unknown) => {
      const parsed = createNoteParamsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return recordAgentToolFailure(
          'create_note',
          serializeAgentToolParams(rawArgs),
          'invalid_arguments',
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
          context,
        );
      }
      const { title, content } = parsed.data;

      const outcome = await withAgentAudit(
        'create_note',
        serializeAgentToolParams({ title, content }),
        async () => {
          const note = await createNote({
            title,
            contentJson: textToDoc(content),
            contentText: content,
          });
          // Distinguish embedding-succeeded vs embedding-disabled in the
          // audit row so consumers (UI, future recovery code) can tell
          // which notes need re-embedding.
          return {
            ok: true as const,
            targetNoteId: note.id,
            result: note.embedded ? 'ok' : 'ok_with_embedding_disabled',
            payload: undefined,
          };
        },
        context,
      );

      if (outcome.ok) {
        return { ok: true, noteId: outcome.targetNoteId, title };
      }
      return { ok: false, error: outcome.error, message: outcome.message };
    },
  });
}

export const createNoteTool = makeCreateNoteTool();