// lib/ai/tools/batch-guard.test.ts
//
// Throwaway unit test for the batch edit/delete guard. Mirrors the
// no-test-framework rule (AGENTS.md).
//
// Run: npx tsx lib/ai/tools/batch-guard.test.ts

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-bg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'bg-test';

type Tool = {
  execute: (...args: unknown[]) => PromiseLike<{ ok: boolean; result?: string }>;
};

type Case = {
  name: string;
  check: () => boolean;
};

let firstResult: unknown = null;
let secondResult: unknown = null;
let thirdResult: unknown = null;
let innerCallCountAfterDisabled = 0;
let innerCallCountTotal = 0;
let rejectedActionRow: {
  action_type: string;
  conversation_id: string | null;
  result: string;
  error_message: string | null;
} | null = null;
let enabledSecondResult: unknown = null;
let freshFirstResult: unknown = null;
let rateLimitResult: unknown = null;
let rateLimitActionRow: {
  action_type: string;
  conversation_id: string | null;
  result: string;
  error_message: string | null;
} | null = null;

async function main(): Promise<void> {
  const { migrate } = await import('../../db/migrate');
  const { getDb, closeDb } = await import('../../db/client');
  const {
    BATCH_EDIT_DELETE_DISABLED_CODE,
    BATCH_EDIT_DELETE_DISABLED_MESSAGE,
    makeBatchEditDeleteCounter,
    withBatchEditDeleteGuard,
  } = await import('./batch-guard');
  const {
    TOOL_LIMIT_EXCEEDED_CODE,
    makeRateLimiter,
    withRateLimit,
  } = await import('./rate-limit');

  try {
    migrate();

    // Shared counter across edit and delete.
    const counter = makeBatchEditDeleteCounter();
    const tool: Tool = {
      execute: (..._args: unknown[]) => {
        innerCallCountTotal += 1;
        return Promise.resolve({
          ok: true,
          result: `inner-${innerCallCountTotal}`,
        });
      },
    };

    const wrappedEdit = withBatchEditDeleteGuard(
      tool,
      counter,
      false,
      'edit_note',
    );
    const wrappedDelete = withBatchEditDeleteGuard(
      tool,
      counter,
      false,
      'delete_note',
      { conversationId: 'conv-batch-test' },
    );

    // First edit passes.
    firstResult = await wrappedEdit.execute({ noteId: 'a' });
    // Second call (delete) is rejected because counter > 1.
    secondResult = await wrappedDelete.execute({ noteId: 'b' });
    // Third call is also rejected.
    thirdResult = await wrappedEdit.execute({ noteId: 'c' });
    innerCallCountAfterDisabled = innerCallCountTotal;

    // Rejected call should have written an agent_actions error row.
    const db = getDb();
    rejectedActionRow = db
      .prepare(
        `SELECT action_type, conversation_id, result, error_message
           FROM agent_actions
          WHERE result = 'error' AND action_type = 'delete_note'
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .get() as {
        action_type: string;
        conversation_id: string | null;
        result: string;
        error_message: string | null;
      } | null;

    // When enabled, multiple calls are allowed.
    const enabledCounter = makeBatchEditDeleteCounter();
    const enabledWrapped = withBatchEditDeleteGuard(
      tool,
      enabledCounter,
      true,
      'edit_note',
    );
    await enabledWrapped.execute({ noteId: 'x' });
    enabledSecondResult = await enabledWrapped.execute({ noteId: 'y' });

    // Fresh counter resets between turns.
    const freshCounter = makeBatchEditDeleteCounter();
    const freshWrapped = withBatchEditDeleteGuard(
      tool,
      freshCounter,
      false,
      'edit_note',
    );
    freshFirstResult = await freshWrapped.execute({ noteId: 'z' });

    const rateLimited = withRateLimit(tool, makeRateLimiter(0), {
      actionType: 'read_note',
      context: { conversationId: 'conv-rate-limit-test' },
    });
    rateLimitResult = await rateLimited.execute({ noteId: 'limit' });
    rateLimitActionRow = db
      .prepare(
        `SELECT action_type, conversation_id, result, error_message
           FROM agent_actions
          WHERE result = 'error' AND action_type = 'read_note'
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .get() as {
        action_type: string;
        conversation_id: string | null;
        result: string;
        error_message: string | null;
      } | null;
  } finally {
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'first call is allowed and runs inner execute',
      check: () =>
        typeof firstResult === 'object' &&
        firstResult !== null &&
        (firstResult as { ok?: unknown }).ok === true &&
        (firstResult as { result?: unknown }).result === 'inner-1',
    },
    {
      name: 'second call (across tool types) is rejected',
      check: () => {
        if (typeof secondResult !== 'object' || secondResult === null)
          return false;
        const r = secondResult as {
          ok?: unknown;
          error?: unknown;
          message?: unknown;
        };
        return (
          r.ok === false &&
          r.error === BATCH_EDIT_DELETE_DISABLED_CODE &&
          r.message === BATCH_EDIT_DELETE_DISABLED_MESSAGE
        );
      },
    },
    {
      name: 'third call is also rejected',
      check: () =>
        typeof thirdResult === 'object' &&
        thirdResult !== null &&
        (thirdResult as { ok?: unknown }).ok === false,
    },
    {
      name: 'inner execute not called for rejected calls',
      check: () => innerCallCountAfterDisabled === 1,
    },
    {
      name: 'rejected call writes agent_actions row with result=error',
      check: () =>
        rejectedActionRow !== null &&
        rejectedActionRow.action_type === 'delete_note' &&
        rejectedActionRow.conversation_id === 'conv-batch-test' &&
        rejectedActionRow.result === 'error' &&
        rejectedActionRow.error_message ===
          '批量编辑/删除已禁用。同一轮对话中只能执行一次 edit_note 或 delete_note。' +
            '如需继续，请用户到「设置 → Agent」开启「允许批量编辑和删除笔记」开关。',
    },
    {
      name: 'when enabled, second call is allowed',
      check: () =>
        typeof enabledSecondResult === 'object' &&
        enabledSecondResult !== null &&
        (enabledSecondResult as { ok?: unknown }).ok === true &&
        (enabledSecondResult as { result?: unknown }).result === 'inner-3',
    },
    {
      name: 'fresh counter allows first call again',
      check: () =>
        typeof freshFirstResult === 'object' &&
        freshFirstResult !== null &&
        (freshFirstResult as { ok?: unknown }).ok === true,
    },
    {
      name: 'rate-limit overflow returns the standard error code',
      check: () =>
        typeof rateLimitResult === 'object' &&
        rateLimitResult !== null &&
        (rateLimitResult as { ok?: unknown }).ok === false &&
        (rateLimitResult as { error?: unknown }).error ===
          TOOL_LIMIT_EXCEEDED_CODE,
    },
    {
      name: 'rate-limit overflow writes an audited row with conversation ID',
      check: () =>
        rateLimitActionRow !== null &&
        rateLimitActionRow.action_type === 'read_note' &&
        rateLimitActionRow.conversation_id === 'conv-rate-limit-test' &&
        rateLimitActionRow.result === 'error' &&
        rateLimitActionRow.error_message === '工具调用次数超过限制',
    },
  ];

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
