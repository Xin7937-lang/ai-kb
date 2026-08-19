// lib/ai/tools/create_note.test.ts
//
// Throwaway integration test for the create_note tool and the agent
// audit wrapper it uses. Mirrors the no-test-framework rule (AGENTS.md);
// cases[] + check pattern from lib/notes/chunk.test.ts.
//
// Run: npx tsx lib/ai/tools/create_note.test.ts
//
// Exits 0 on success, 1 on any failed assertion.

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-cn-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'cn-test';

// Module-scoped state, populated inside main() before cases run.
let executeHappy: { ok: boolean; noteId?: string; title?: string } | null = null;
let notesRow: { id: string; title: string } | null = null;
let agentActionsOkRow: {
  conversation_id: string | null;
  result: string;
  target_note_id: string | null;
  error_message: string | null;
} | null = null;
let agentActionsErrorRow: {
  result: string;
  error_message: string | null;
} | null = null;
let schemaEmptyTitle: boolean | null = null;
let schemaLongTitle: boolean | null = null;
let schemaLongContent: boolean | null = null;
let schemaValid: boolean | null = null;

type Case = {
  name: string;
  check: () => boolean;
};

const cases: Case[] = [
  // ── audit wrapper (via execute happy path) ──
  {
    name: 'execute returns {ok: true, noteId, title}',
    check: () =>
      executeHappy !== null &&
      executeHappy.ok === true &&
      typeof executeHappy.noteId === 'string' &&
      executeHappy.title === 'Slice 3 test note',
  },
  {
    name: 'notes table gets a row matching the returned noteId',
    check: () =>
      notesRow !== null &&
      notesRow.id === executeHappy!.noteId &&
      notesRow.title === 'Slice 3 test note',
  },
  {
    name: 'agent_actions row inserted with result reflecting embedding status + matching target_note_id',
    check: () =>
      agentActionsOkRow !== null &&
      // Test env has no default embedding model configured, so the
      // tool falls back to the embedding-disabled result code.
      agentActionsOkRow.result === 'ok_with_embedding_disabled' &&
      agentActionsOkRow.conversation_id === 'conv-create-test' &&
      agentActionsOkRow.target_note_id === executeHappy!.noteId &&
      agentActionsOkRow.error_message === null,
  },
  // ── embedding-disabled fallback (Slice 4) ──
  {
    name: 'execute returns {ok: true} even when embedding is disabled',
    check: () => executeHappy !== null && executeHappy.ok === true,
  },
  // ── audit wrapper error path ──
  {
    name: 'audit wrapper marks row result="error" + error_message when work throws',
    check: () =>
      agentActionsErrorRow !== null &&
      agentActionsErrorRow.result === 'error' &&
      typeof agentActionsErrorRow.error_message === 'string' &&
      agentActionsErrorRow.error_message.length > 0,
  },
  // ── Zod schema validation ──
  {
    name: 'parameters rejects empty title',
    check: () => schemaEmptyTitle === false,
  },
  {
    name: 'parameters rejects title > 200 chars',
    check: () => schemaLongTitle === false,
  },
  {
    name: 'parameters rejects content > 50000 chars',
    check: () => schemaLongContent === false,
  },
  {
    name: 'parameters accepts a valid payload',
    check: () => schemaValid === true,
  },
  // buildToolsConfig() coverage lives in lib/ai/tools-config.test.ts
];

async function main(): Promise<void> {
  const { migrate } = await import('../../db/migrate');
  const { getDb, closeDb } = await import('../../db/client');
  const { setAgentToolLimit } = await import('@/lib/auth/init');
  const { makeCreateNoteTool } = await import('./create_note');
  const { withAgentAudit } = await import('./agent-audit');

  try {
    migrate();
    const createNoteTool = makeCreateNoteTool({
      conversationId: 'conv-create-test',
    });

    // ── execute happy path ──
    setAgentToolLimit(100); // ensure we don't accidentally hit any rate limit
    executeHappy = (await createNoteTool.execute(
      { title: 'Slice 3 test note', content: 'Hello world.' },
      {},
    )) as { ok: boolean; noteId?: string; title?: string };

    if (executeHappy?.noteId) {
      const db = getDb();
      notesRow = db
        .prepare<[string], { id: string; title: string }>(
          'SELECT id, title FROM notes WHERE id = ?',
        )
        .get(executeHappy.noteId) ?? null;
      agentActionsOkRow = db
        .prepare<[string], {
          conversation_id: string | null;
          result: string;
          target_note_id: string | null;
          error_message: string | null;
        }>(
          'SELECT conversation_id, result, target_note_id, error_message FROM agent_actions WHERE target_note_id = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(executeHappy.noteId) ?? null;
    }

    // ── audit wrapper error path ──
    const failResult = await withAgentAudit(
      'create_note',
      '{"title":"x"}',
      async () => {
        throw new Error('synthetic failure for test');
      },
    );
    // failResult shape: { ok: false, actionId, error, message }
    if (!failResult.ok) {
      agentActionsErrorRow = getDb()
        .prepare<[string], {
          result: string;
          error_message: string | null;
        }>(
          'SELECT result, error_message FROM agent_actions WHERE id = ?',
        )
        .get((failResult as { actionId: string }).actionId) ?? null;
    }

    // ── Zod schema validation ──
    // The parameters field on a Vercel AI SDK tool is the Zod schema.
    const params = (createNoteTool as unknown as { parameters: { safeParse: (v: unknown) => { success: boolean } } })
      .parameters;
    schemaEmptyTitle = params.safeParse({ title: '', content: 'x' }).success;
    schemaLongTitle = params.safeParse({ title: 'a'.repeat(201), content: 'x' }).success;
    schemaLongContent = params.safeParse({ title: 'ok', content: 'a'.repeat(50001) }).success;
    schemaValid = params.safeParse({ title: 'ok', content: 'fine' }).success;
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
        console.error(`FAIL: ${c.name}`);
        failed++;
      } else {
        console.log(`PASS: ${c.name}`);
      }
    } catch (err) {
      console.error(`ERROR in ${c.name}:`, err);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} tests passed`);
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(1);
});