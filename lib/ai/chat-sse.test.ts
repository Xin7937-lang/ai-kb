// lib/ai/chat-sse.test.ts
//
// Throwaway test for mapStreamPartToSseEvent. Mirrors the no-test-framework
// rule (AGENTS.md); cases[] + check pattern.
//
// Run: npx tsx lib/ai/chat-sse.test.ts
//
// Exits 0 on success, 1 on any failed assertion.

import { mapStreamPartToSseEvent } from './chat-sse';

type Case = {
  name: string;
  part: unknown;
  check: (out: ReturnType<typeof mapStreamPartToSseEvent>) => boolean;
};

const cases: Case[] = [
  {
    name: 'text-delta → { type: "delta", delta: <text> }',
    part: { type: 'text-delta', textDelta: 'hello' },
    check: (out) =>
      out !== null &&
      out.type === 'delta' &&
      (out as { delta: string }).delta === 'hello',
  },
  {
    name: 'tool-call → { type: "tool_call", toolCallId, toolName, args }',
    part: {
      type: 'tool-call',
      toolCallId: 'tc-1',
      toolName: 'create_note',
      args: { title: 'x', content: 'y' },
    },
    check: (out) => {
      const e = out as { type: string; toolCallId?: string; toolName?: string; args?: unknown } | null;
      return (
        e !== null &&
        e.type === 'tool_call' &&
        e.toolCallId === 'tc-1' &&
        e.toolName === 'create_note' &&
        JSON.stringify(e.args) === JSON.stringify({ title: 'x', content: 'y' })
      );
    },
  },
  {
    name: 'tool-result → { type: "tool_result", toolCallId, result }',
    part: {
      type: 'tool-result',
      toolCallId: 'tc-1',
      toolName: 'create_note',
      args: { title: 'x', content: 'y' },
      result: { ok: true, noteId: 'abc', title: 'x' },
    },
    check: (out) => {
      const e = out as { type: string; toolCallId?: string; result?: unknown } | null;
      return (
        e !== null &&
        e.type === 'tool_result' &&
        e.toolCallId === 'tc-1' &&
        JSON.stringify(e.result) ===
          JSON.stringify({ ok: true, noteId: 'abc', title: 'x' })
      );
    },
  },
  {
    name: 'error → { type: "error", error: <message> }',
    part: { type: 'error', error: new Error('boom') },
    check: (out) => {
      const e = out as { type: string; error?: string } | null;
      return e !== null && e.type === 'error' && e.error === 'boom';
    },
  },
  {
    name: 'finish → null (caller emits done after loop)',
    part: {
      type: 'finish',
      finishReason: 'stop',
      logprobs: undefined,
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      },
      response: {
        id: 'r1',
        modelId: 'm1',
        timestamp: new Date(),
      },
      experimental_providerMetadata: undefined,
    },
    check: (out) => out === null,
  },
  {
    name: 'step-finish → null',
    part: {
      type: 'step-finish',
      finishReason: 'stop',
      logprobs: undefined,
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      },
      response: {
        id: 'r1',
        modelId: 'm1',
        timestamp: new Date(),
      },
      experimental_providerMetadata: undefined,
      isContinued: false,
    },
    check: (out) => out === null,
  },
  {
    name: 'tool-call-streaming-start → null',
    part: {
      type: 'tool-call-streaming-start',
      toolCallId: 'tc-1',
      toolName: 'create_note',
    },
    check: (out) => out === null,
  },
  {
    name: 'tool-call-delta → null',
    part: {
      type: 'tool-call-delta',
      toolCallId: 'tc-1',
      toolName: 'create_note',
      argsTextDelta: '{"title":',
    },
    check: (out) => out === null,
  },
];

let failed = 0;
(async () => {
  for (const c of cases) {
    try {
      const out = mapStreamPartToSseEvent(c.part);
      if (!c.check(out)) {
        console.error(`FAIL: ${c.name}`);
        console.error(`  got: ${JSON.stringify(out)}`);
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
})();