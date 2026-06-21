// PUT /api/settings/chat-web-search -- toggle whether the chat may fall back
// to model knowledge / web search when no notes are retrieved.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { setChatWebSearchEnabled } from '@/lib/auth/init';

export const runtime = 'nodejs';

const Body = z.object({
  enabled: z.boolean(),
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
      { error: 'invalid_body', message: 'enabled 必须是布尔值' },
      { status: 400 },
    );
  }

  setChatWebSearchEnabled(parsed.data.enabled);
  return NextResponse.json({ ok: true });
}
