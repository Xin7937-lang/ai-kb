// PUT /api/settings/chat-retrieve-limit -- change the RAG retrieval limit.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  setChatRetrieveLimit,
  CHAT_RETRIEVE_LIMIT_MIN,
  CHAT_RETRIEVE_LIMIT_MAX,
} from '@/lib/auth/init';

export const runtime = 'nodejs';

const Body = z.object({
  limit: z.number().int().min(CHAT_RETRIEVE_LIMIT_MIN).max(CHAT_RETRIEVE_LIMIT_MAX),
});

export async function PUT(request: NextRequest) {
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
      {
        error: 'invalid_body',
        message: `limit 必须是 ${CHAT_RETRIEVE_LIMIT_MIN}~${CHAT_RETRIEVE_LIMIT_MAX} 的整数`,
      },
      { status: 400 },
    );
  }

  setChatRetrieveLimit(parsed.data.limit);
  return NextResponse.json({ ok: true });
}
