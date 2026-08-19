// scripts/smoke-agent.ts
//
// End-to-end smoke for the agent tool-calling pipeline (ticket 06).
// Spins up a throwaway DB, calls streamChat() directly with a mocked
// LLM endpoint, and asserts:
//   - SSE events: sources, tool_call for all four note tools,
//     tool_result, done
//   - DB state: notes created / edited / soft-deleted, agent_actions rows
//     with result='ok' and target_note_id set.
//
// We mock at the `global.fetch` level rather than standing up a
// real HTTP server — the OpenAI-compatible client used by
// streamChat delegates to fetch, so swapping the global is enough
// to intercept all LLM traffic. The mock handles both
// /v1/chat/completions and /v1/embeddings endpoints.
//
// Follows the env-first dynamic-import pattern from scripts/smoke-db.ts
// and scripts/smoke-embed.ts: loadEnvFile + env-vars before any
// transitive import of lib/env.ts; dynamic imports for everything
// else inside main(). Cleans up the throwaway DB plus its
// better-sqlite3 WAL/SHM sidecar files.

import { existsSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path, { resolve } from 'path';

function loadEnvFile(filename: string): void {
  const p = resolve(process.cwd(), filename);
  if (!existsSync(p)) return;
  const raw = readFileSync(p, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// Load env BEFORE any import that transitively pulls in lib/env.ts.
loadEnvFile('.env.local');
loadEnvFile('.env');

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

type Scenario = 'create' | 'read' | 'edit' | 'delete';

let notesRow: { id: string; title: string } | null = null;
let editedRow: { id: string; title: string } | null = null;
let deletedRow: { id: string; deleted_at: number | null } | null = null;
let createActionRow: {
  conversation_id: string | null;
  result: string;
  target_note_id: string | null;
  error_message: string | null;
} | null = null;
let readActionRow: {
  conversation_id: string | null;
  result: string;
  target_note_id: string | null;
  error_message: string | null;
} | null = null;
let editActionRow: {
  conversation_id: string | null;
  result: string;
  target_note_id: string | null;
  error_message: string | null;
} | null = null;
let deleteActionRow: {
  conversation_id: string | null;
  result: string;
  target_note_id: string | null;
  error_message: string | null;
} | null = null;
let embeddingRowCount: number | null = null;
let eventTypes = '';
let hasToolCallForCreateNote = false;
let hasToolCallForReadNote = false;
let hasToolCallForEditNote = false;
let hasToolCallForDeleteNote = false;
let hasToolResult = false;
let hasDone = false;
let chatCallCount = 0;
let embeddingCallCount = 0;
let currentScenario: Scenario = 'create';
let scenarioChatCallIndex = 0;
const smokeConversationId = 'conv-smoke-agent';

async function main(): Promise<void> {
  const { migrate } = await import('../lib/db/migrate');
  const { getDb, closeDb } = await import('../lib/db/client');
  const { initAuthFromEnv, setAgentToolsEnabled } = await import(
    '../lib/auth/init'
  );
  const { encrypt } = await import('../lib/crypto');
  const { streamChat } = await import('../lib/ai/chat');
  const { EMBEDDING_DIMENSION } = await import('../lib/ai/embeddings');

  // ----- Mock LLM via global.fetch (chat + embeddings endpoints) -----
  const realFetch = global.fetch;
  global.fetch = ((input: unknown, init?: { body?: string | null }) => {
    const url = String(input);
    // Embeddings endpoint: POST {baseUrl}/embeddings
    if (url.endsWith('/embeddings')) {
      embeddingCallCount++;
      const body = init?.body ? (JSON.parse(init.body) as { input?: string[] }) : { input: [] };
      const inputs = body.input ?? [];
      return Promise.resolve(
        jsonResponse({
          object: 'list',
          data: inputs.map(() => ({
            object: 'embedding',
            index: 0,
            embedding: new Array(EMBEDDING_DIMENSION).fill(0),
          })),
          model: 'mock-embed-model',
          usage: { prompt_tokens: 0, total_tokens: 0 },
        }),
      );
    }
    // Chat completions endpoint: POST {baseUrl}/chat/completions
    chatCallCount++;
    scenarioChatCallIndex++;

    if (currentScenario === 'create') {
      if (scenarioChatCallIndex === 1) {
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
                        id: 'call_smoke_create',
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
            choices: [{ index: 0, delta: { content: '笔记 smoke test。' } }],
          }),
          chatChunk({
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }),
          'data: [DONE]\n\n',
        ]),
      );
    }

    if (currentScenario === 'read') {
      if (scenarioChatCallIndex === 1) {
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
                        id: 'call_smoke_read',
                        type: 'function',
                        function: { name: 'read_note', arguments: '' },
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
                          arguments: '{"noteId":"note-read"}',
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
                delta: { role: 'assistant', content: '已读取' },
              },
            ],
          }),
          chatChunk({
            choices: [{ index: 0, delta: { content: '笔记 note-read。' } }],
          }),
          chatChunk({
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }),
          'data: [DONE]\n\n',
        ]),
      );
    }

    if (currentScenario === 'edit') {
      if (scenarioChatCallIndex === 1) {
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
                        id: 'call_smoke_edit',
                        type: 'function',
                        function: { name: 'edit_note', arguments: '' },
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
                            '{"noteId":"note-edit","updates":{"title":"smoke edited"}}',
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
                delta: { role: 'assistant', content: '已编辑' },
              },
            ],
          }),
          chatChunk({
            choices: [{ index: 0, delta: { content: '笔记标题为 smoke edited。' } }],
          }),
          chatChunk({
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }),
          'data: [DONE]\n\n',
        ]),
      );
    }

    // currentScenario === 'delete'
    if (scenarioChatCallIndex === 1) {
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
                      id: 'call_smoke_delete',
                      type: 'function',
                      function: { name: 'delete_note', arguments: '' },
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
                        arguments: '{"noteId":"note-delete"}',
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
              delta: { role: 'assistant', content: '已删除' },
            },
          ],
        }),
        chatChunk({
          choices: [{ index: 0, delta: { content: '笔记 note-delete。' } }],
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

    // Configure chat + embedding models pointing at the mock URL.
    const db = getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO model_configs
         (id, name, base_url, api_key_enc, model, kind, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, 'chat', 1, ?)`,
    ).run(
      'mock-chat',
      'mock chat',
      'http://mock.local/v1',
      encrypt('sk-mock'),
      'mock-chat-model',
      now,
    );
    db.prepare(
      `INSERT INTO model_configs
         (id, name, base_url, api_key_enc, model, kind, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, 'embedding', 1, ?)`,
    ).run(
      'mock-embed',
      'mock embed',
      'http://mock.local/v1',
      encrypt('sk-mock'),
      'mock-embed-model',
      now,
    );

    // Seed notes for the edit and delete scenarios so the mock can
    // reference deterministic ids.
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run(
      'note-edit',
      'seed edit',
      '{"type":"doc"}',
      'seed edit content',
      now,
      now,
    );
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run(
      'note-read',
      'seed read',
      '{"type":"doc"}',
      'seed read content',
      now,
      now,
    );
    db.prepare(
      `INSERT INTO notes (id, title, content_json, content_text, summary, summary_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'none', ?, ?)`,
    ).run(
      'note-delete',
      'seed delete',
      '{"type":"doc"}',
      'seed delete content',
      now,
      now,
    );

    // ----- Scenario 1: create_note -----
    currentScenario = 'create';
    scenarioChatCallIndex = 0;
    await runScenario(streamChat, [
      { role: 'user', content: '请帮我创建一个测试笔记，标题 smoke test。' },
    ]);

    // ----- Scenario 2: read_note -----
    currentScenario = 'read';
    scenarioChatCallIndex = 0;
    await runScenario(streamChat, [
      { role: 'user', content: '请读取 note-read。' },
    ]);

    // ----- Scenario 3: edit_note -----
    currentScenario = 'edit';
    scenarioChatCallIndex = 0;
    await runScenario(streamChat, [
      { role: 'user', content: '请把 note-edit 的标题改成 smoke edited。' },
    ]);

    // ----- Scenario 4: delete_note -----
    currentScenario = 'delete';
    scenarioChatCallIndex = 0;
    await runScenario(streamChat, [
      { role: 'user', content: '请删除 note-delete。' },
    ]);

    // Assert DB state. streamChat awaits tool execution inline (the
    // tool runs server-side before the stream completes), so by the
    // time streamChat resolves, the note + agent_action + embedding
    // rows should already be persisted.
    notesRow =
      db
        .prepare<[string], { id: string; title: string }>(
          `SELECT id, title FROM notes WHERE title = ?`,
        )
        .get('smoke test') ?? null;

    editedRow =
      db
        .prepare<[string], { id: string; title: string }>(
          `SELECT id, title FROM notes WHERE id = ?`,
        )
        .get('note-edit') ?? null;

    deletedRow =
      db
        .prepare<[string], { id: string; deleted_at: number | null }>(
          `SELECT id, deleted_at FROM notes WHERE id = ?`,
        )
        .get('note-delete') ?? null;

    createActionRow =
      db
        .prepare<[], {
          conversation_id: string | null;
          result: string;
          target_note_id: string | null;
          error_message: string | null;
        }>(
          `SELECT conversation_id, result, target_note_id, error_message
             FROM agent_actions
            WHERE action_type = 'create_note'
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get() ?? null;

    readActionRow =
      db
        .prepare<[], {
          conversation_id: string | null;
          result: string;
          target_note_id: string | null;
          error_message: string | null;
        }>(
          `SELECT conversation_id, result, target_note_id, error_message
             FROM agent_actions
            WHERE action_type = 'read_note'
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get() ?? null;

    editActionRow =
      db
        .prepare<[], {
          conversation_id: string | null;
          result: string;
          target_note_id: string | null;
          error_message: string | null;
        }>(
          `SELECT conversation_id, result, target_note_id, error_message
             FROM agent_actions
            WHERE action_type = 'edit_note'
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get() ?? null;

    deleteActionRow =
      db
        .prepare<[], {
          conversation_id: string | null;
          result: string;
          target_note_id: string | null;
          error_message: string | null;
        }>(
          `SELECT conversation_id, result, target_note_id, error_message
             FROM agent_actions
            WHERE action_type = 'delete_note'
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get() ?? null;

    // sqlite-vec extension isn't loaded in the test env, so the
    // note_chunks_vec table is never created (see migration v3). The
    // embedding path still runs but writes nothing. We verify the
    // note_chunks table was populated as proof the path executed.
    embeddingRowCount = (db
      .prepare<[string], { c: number }>(
        `SELECT COUNT(*) AS c FROM note_chunks WHERE note_id = ?`,
      )
      .get(notesRow?.id ?? '') ?? { c: 0 }).c;
  } finally {
    global.fetch = realFetch;
    closeDb();
    // Remove the DB plus better-sqlite3 WAL/SHM sidecars.
    for (const p of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      if (existsSync(p)) unlinkSync(p);
    }
  }

  const cases: Case[] = [
    {
      name: 'mock chat endpoint was called at least 8 times (4 scenarios × 2 calls)',
      check: () => chatCallCount >= 8,
    },
    {
      name: 'mock embedding endpoint was called at least once',
      check: () => embeddingCallCount >= 1,
    },
    {
      name: 'SSE events included tool_call for create_note',
      check: () => hasToolCallForCreateNote,
    },
    {
      name: 'SSE events included tool_call for read_note',
      check: () => hasToolCallForReadNote,
    },
    {
      name: 'SSE events included tool_call for edit_note',
      check: () => hasToolCallForEditNote,
    },
    {
      name: 'SSE events included tool_call for delete_note',
      check: () => hasToolCallForDeleteNote,
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
      name: 'DB has agent_actions row for create_note with result="ok" and target_note_id set',
      check: () =>
        createActionRow !== null &&
        createActionRow.conversation_id === smokeConversationId &&
        createActionRow.result === 'ok' &&
        createActionRow.target_note_id !== null &&
        createActionRow.error_message === null,
    },
    {
      name: 'create_note target_note_id matches the created note id',
      check: () =>
        notesRow !== null &&
        createActionRow !== null &&
        createActionRow.target_note_id === notesRow.id,
    },
    {
      name: 'DB has note-edit row titled "smoke edited"',
      check: () => editedRow !== null && editedRow.title === 'smoke edited',
    },
    {
      name: 'DB has agent_actions row for edit_note with result="ok" and target_note_id=note-edit',
      check: () =>
        editActionRow !== null &&
        editActionRow.conversation_id === smokeConversationId &&
        editActionRow.result === 'ok' &&
        editActionRow.target_note_id === 'note-edit' &&
        editActionRow.error_message === null,
    },
    {
      name: 'DB has note-delete row with deleted_at set',
      check: () =>
        deletedRow !== null &&
        deletedRow.deleted_at !== null &&
        deletedRow.deleted_at > 0,
    },
    {
      name: 'DB has agent_actions row for delete_note with result="ok" and target_note_id=note-delete',
      check: () =>
        deleteActionRow !== null &&
        deleteActionRow.conversation_id === smokeConversationId &&
        deleteActionRow.result === 'ok' &&
        deleteActionRow.target_note_id === 'note-delete' &&
        deleteActionRow.error_message === null,
    },
    {
      name: 'DB has agent_actions row for read_note with conversation and target_note_id',
      check: () =>
        readActionRow !== null &&
        readActionRow.conversation_id === smokeConversationId &&
        readActionRow.result === 'ok' &&
        readActionRow.target_note_id === 'note-read' &&
        readActionRow.error_message === null,
    },
    {
      name: 'note_chunks has rows for the created note (embedding path executed)',
      check: () => embeddingRowCount !== null && embeddingRowCount > 0,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
        console.error(`[smoke-agent] FAIL: ${c.name}`);
        if (failed === 0) {
          // First failure: dump diagnostic context.
          console.error(`[smoke-agent]   eventTypes: ${eventTypes || '(empty)'}`);
          console.error(`[smoke-agent]   chatCallCount: ${chatCallCount}`);
          console.error(`[smoke-agent]   embeddingCallCount: ${embeddingCallCount}`);
        }
        failed++;
      } else {
        console.log(`[smoke-agent] PASS: ${c.name}`);
      }
    } catch (err) {
      console.error(`[smoke-agent] ERROR in ${c.name}:`, err);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n[smoke-agent] ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\n[smoke-agent] All ${cases.length} tests passed`);
  // Force exit — Vercel SDK's internal stream cleanup can leave
  // dangling async work that re-opens the (now-deleted) DB. Exiting
  // immediately avoids the spurious "no such table: settings"
  // traceback. Cleanup already ran in the finally block above.
  process.exit(0);
}

async function runScenario(
  streamChat: (typeof import('../lib/ai/chat'))['streamChat'],
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<void> {
  let result: Awaited<ReturnType<typeof streamChat>>;
  try {
    result = await streamChat(messages, {
      conversationId: smokeConversationId,
    });
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
          if (t === 'tool_call' && data['toolName'] === 'read_note') {
            hasToolCallForReadNote = true;
          }
          if (t === 'tool_call' && data['toolName'] === 'edit_note') {
            hasToolCallForEditNote = true;
          }
          if (t === 'tool_call' && data['toolName'] === 'delete_note') {
            hasToolCallForDeleteNote = true;
          }
          if (t === 'tool_result') hasToolResult = true;
          if (data['done'] === true) hasDone = true;
          if (t === 'error' && typeof data['error'] === 'string') {
            console.error('[smoke-agent] [error] SSE error event:', data['error']);
          }
        } catch (err) {
          // Malformed line: log with prefix, don't swallow silently.
          console.warn('[smoke-agent] malformed SSE frame:', err);
        }
      }
      idx = buffer.indexOf('\n\n');
    }
  }
}

// ----- Mock helpers -----

function chatChunk(payload: Record<string, unknown>): string {
  return (
    'data: ' +
    JSON.stringify({
      id: 'chatcmpl-smoke',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'mock-chat-model',
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

main().catch((err) => {
  console.error('[smoke-agent] test runner crashed:', err);
  process.exit(1);
});
