// POST /api/notes/:id/summarize — start an AI summary stream for one note.
//
// On success, the response is an `text/event-stream` of SSE events:
//   data: {"delta": "..."}\n\n              (one per text chunk from the model)
//   data: {"done": true, "summary": "..."}\n\n   (exactly one, on completion)
// On failure, the stream contains a single terminal error event:
//   data: {"error": "..."}\n\n
//
// Setup errors (no default model, note not found, etc.) come back as a
// regular JSON 4xx/5xx response with no stream body — this lets the client
// distinguish "the request never started" from "the request started and
// later errored". The detail page button handles both cases.

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getNote } from '@/lib/notes/queries';
import {
  streamSummary,
  type SummaryStreamResult,
} from '@/lib/ai/summarize';
import { NoDefaultModelError, NoSuchModelError } from '@/lib/ai/errors';

export const runtime = 'nodejs';

interface RouteContext {
  params: { id: string };
}

const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Disable Nginx-style buffering on common reverse proxies.
  'X-Accel-Buffering': 'no',
};

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const note = getNote(params.id);
  if (!note) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let result: SummaryStreamResult;
  try {
    result = await streamSummary(params.id);
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
    if (err instanceof Error && err.message === 'note_not_found') {
      // Race: note deleted between the SELECT above and the summarize call.
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    console.error('[summarize] failed to start:', err);
    return NextResponse.json(
      { error: 'summarize_failed', message: 'Failed to start summarization' },
      { status: 500 },
    );
  }

  return new Response(result.stream, { headers: SSE_HEADERS });
}
