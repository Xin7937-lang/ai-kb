// POST /api/chat -- RAG chat over the user's notes.
//
// On success, returns a text/event-stream of SSE events:
//   data: {"sources": [{id, title}, ...]}\n\n   (exactly one, on start)
//   data: {"delta": "..."}\n\n                (one per text chunk)
//   data: {"done": true, "fullText": "..."}\n\n   (exactly one, on completion)
// On failure, a single error event:
//   data: {"error": "..."}\n\n
//
// Setup errors (no default model, etc.) come back as a regular JSON
// response so the client can distinguish "never started" from
// "started and later failed".

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { getChatWebSearchEnabled } from '@/lib/auth/init';
import { streamChat } from '@/lib/ai/chat';
import { NoDefaultModelError, NoSuchModelError } from '@/lib/ai/errors';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

const Body = z.object({
  /**
   * Full conversation history up to and including the current user
   * question. Must contain at least one `user` turn.
   */
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  modelId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'messages 至少 1 条且不超过 40 条' },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await streamChat(parsed.data.messages, {
      modelId: parsed.data.modelId,
      webSearchEnabled: getChatWebSearchEnabled(),
    });
  } catch (err) {
    if (err instanceof NoDefaultModelError) {
      return NextResponse.json(
        {
          error: 'no_default_model',
          message: '请先在「设置 → 模型」中配置默认模型',
        },
        { status: 503 },
      );
    }
    if (err instanceof NoSuchModelError) {
      return NextResponse.json(
        { error: 'no_such_model', message: '指定的模型配置不存在' },
        { status: 404 },
      );
    }
    if (err instanceof Error) {
      if (err.message.startsWith('chat: ')) {
        return NextResponse.json(
          { error: 'invalid_body', message: err.message },
          { status: 400 },
        );
      }
    }
    console.error('[chat] failed to start:', err);
    return NextResponse.json(
      { error: 'chat_failed', message: 'Failed to start chat' },
      { status: 500 },
    );
  }

  return new Response(result.stream, { headers: SSE_HEADERS });
}
