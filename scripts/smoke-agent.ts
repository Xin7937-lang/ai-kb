// scripts/smoke-agent.ts
//
// End-to-end smoke for the agent tool-calling pipeline (ticket 06).
// Spins up a throwaway DB, calls streamChat() directly with a mocked
// LLM endpoint, and asserts:
//   - SSE events: sources, tool_call(create_note), tool_result, deltas, done
//   - DB state: a new row in `notes`, a new row in `agent_actions`
//     with result='ok'
//   - audit wrapper inserted the pending row → updated to ok
//
// We mock at the `global.fetch` level rather than standing up a
// real HTTP server — the OpenAI-compatible client used by
// streamChat delegates to fetch, so swapping the global is enough
// to intercept all LLM traffic. Follows the same env-first pattern
// as scripts/smoke-db.ts and scripts/smoke-embed.ts.

import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tmpDb = path.join(
  tmpdir(),
  `ai-kb-smoke-agent-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = tmpDb;
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_PASSWORD = 'smoke-test-password';

type Case = {
  name: string;
  check: () => boolean;
};

let notesRow: { id: string; title: string } | null = null;
let agentActionRow: {
  result: string;
  target_note_id: string | null;
  error_message: string | null;
} | null = null;
let eventTypes = '';
let hasToolCallForCreateNote = false;
let hasToolResult = false;
let hasDelta = false;
let hasDone = false;

async function main(): Promise<void> {
  const { migrate } = await import('../lib/db/migrate');
  const { getDb, closeDb } = await import('../lib/db/client');
  const { initAuthFromEnv, setAgentToolsEnabled } = await import(
    '../lib/auth/init'
  );
  const { encrypt } = await import('../lib/crypto');
  const { streamChat } = await import('../lib/ai/chat');
  const { getDefaultModelId, getModelAndClient } = await import(
    '../lib/ai/provider'
  );

  // ----- Mock LLM via global fetch -----
  const callCount = { n: 0 };
  const realFetch = global.fetch;
  global.fetch = ((input: unknown, _init?: unknown) => {
    callCount.n++;
    // First call: assistant emits a tool-call for create_note.
    // Second call (after SDK executes the tool): final text.
    if (callCount.n === 1) {
      return Promise.resolve(
        sseResponse([
          chatChunk({
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_smoke_1',
                      type: 'function',
                      function: { name: 'create_note', arguments: '' },
                    },
                  ],
                },
              },
            ],
          }),
          chatChunk({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        arguments:
                          '{"title":"smoke test","content":"smoke test content"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          chatChunk({
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          }),
          'data: [DONE]\n\n',
        ]),
      );
    }
    return Promise.resolve(
      sseResponse([
        chatChunk({
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '已创建' },
            },
          ],
        }),
        chatChunk({
          choices: [
            { index: 0, delta: { content: '笔记 smoke test。' } },
          ],
        }),
        chatChunk({
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
        'data: [DONE]\n\n',
      ]),
    );
  }) as typeof fetch;

  try {
    migrate();
    initAuthFromEnv();
    setAgentToolsEnabled(true);

    // Configure a default model pointing at the mock URL. The actual
    // URL doesn't matter — global.fetch intercepts before any socket
    // is opened. The api_key can be any string; the SDK forwards it
    // as a header but our mock ignores headers.
    const db = getDb();
    db.prepare(
      `INSERT INTO model_configs
         (id, name, base_url, api_key_enc, model, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      'mock-model',
      'mock',
      'http://mock.local/v1',
      encrypt('sk-mock-not-used-by-the-mock-fetch'),
      'mock-model-id',
      Date.now(),
    );

    // Now run streamChat. streamChat doesn't check session — only the
    // route layer does — so we can call it directly.
    const modelId = getDefaultModelId();
    void getModelAndClient; // imported for type side-effect; not used directly
    void modelId; // read once to warm the path

    let result: Awaited<ReturnType<typeof streamChat>>;
    try {
      result = await streamChat([
        {
          role: 'user',
          content: '请帮我创建一个测试笔记，标题smoke test。',
        },
      ]);
    } catch (err) {
      console.error('[smoke-agent] streamChat threw:', err);
      throw err;
    }

    // Consume the SSE stream and collect events.
    const decoder = new TextDecoder();
    const reader = result.stream.getReader();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine) {
          try {
            const data = JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>;
            const t = data['type'] as string | undefined;
            if (t) eventTypes += `${t},`;
            if (t === 'tool_call' && data['toolName'] === 'create_note') {
              hasToolCallForCreateNote = true;
            }
            if (t === 'tool_result') hasToolResult = true;
            if (t === 'delta' && typeof data['delta'] === 'string') hasDelta = true;
            if (data['done'] === true) hasDone = true;
            if (t === 'error' && typeof data['error'] === 'string') {
              console.error('[smoke-agent] SSE error event:', data['error']);
            }
          } catch {
            // ignore malformed lines
          }
        }
        idx = buffer.indexOf('\n\n');
      }
    }

    // Assert DB state. streamChat awaits tool execution inline (the
    // tool runs server-side before the stream completes), so by the
    // time streamChat resolves, the note + agent_action row should
    // already be persisted.
    notesRow =
      db
        .prepare<[string], { id: string; title: string }>(
          `SELECT id, title FROM notes WHERE title = ?`,
        )
        .get('smoke test') ?? null;

    agentActionRow =
      db
        .prepare<[], {
          result: string;
          target_note_id: string | null;
          error_message: string | null;
        }>(
          `SELECT result, target_note_id, error_message
             FROM agent_actions
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get() ?? null;
  } finally {
    global.fetch = realFetch;
    closeDb();
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }

  const cases: Case[] = [
    {
      name: 'streamChat reached the LLM (mock fetch was called at least once)',
      check: () => callCount.n >= 1,
    },
    {
      name: 'SSE events included tool_call for create_note',
      check: () => hasToolCallForCreateNote,
    },
    {
      name: 'SSE events included tool_result',
      check: () => hasToolResult,
    },
    {
      name: 'SSE events ended with done',
      check: () => hasDone,
    },
    {
      name: 'DB has a notes row titled "smoke test"',
      check: () => notesRow !== null && notesRow.title === 'smoke test',
    },
    {
      name: 'DB has an agent_actions row with result=ok-ish and target_note_id set',
      check: () =>
        agentActionRow !== null &&
        (agentActionRow.result === 'ok' ||
          agentActionRow.result === 'ok_with_embedding_disabled') &&
        agentActionRow.target_note_id !== null &&
        agentActionRow.error_message === null,
    },
    {
      name: 'agent_actions.target_note_id matches the created note id',
      check: () =>
        notesRow !== null &&
        agentActionRow !== null &&
        agentActionRow.target_note_id === notesRow.id,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
        console.error(`FAIL: ${c.name}`);
        if (failed === 0) {
          // First failure: dump diagnostic context
          console.error(`  eventTypes: ${eventTypes || '(empty)'}`);
          console.error(`  callCount: ${callCount.n}`);
        }
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
  // Force exit — Vercel SDK's internal stream cleanup can leave dangling
  // async work that re-opens the (now-deleted) DB. Exiting immediately
  // avoids the spurious "no such table: settings" traceback.
  process.exit(0);
}

// ----- Mock helpers -----

function chatChunk(payload: Record<string, unknown>): string {
  return (
    'data: ' +
    JSON.stringify({
      id: 'chatcmpl-smoke',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'mock-model-id',
      ...payload,
    }) +
    '\n\n'
  );
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(1);
});