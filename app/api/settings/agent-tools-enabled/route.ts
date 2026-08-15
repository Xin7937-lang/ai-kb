// PUT /api/settings/agent-tools-enabled -- master toggle for the
// /chat agent's tool-calling capability. When false, streamChat
// runs text-only with no tools mounted; when true, create_note
// and read_note tools are registered.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/lib/auth/session';
import { setAgentToolsEnabled } from '@/lib/auth/init';

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

  setAgentToolsEnabled(parsed.data.enabled);
  return NextResponse.json({ ok: true });
}