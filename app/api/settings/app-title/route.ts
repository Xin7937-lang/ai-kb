// PUT /api/settings/app-title -- change the sidebar app title.
//
// Persists to the `settings` KV table. The (app) layout re-reads on
// every request so the new value is picked up immediately.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { setAppTitle } from '@/lib/auth/init';

export const runtime = 'nodejs';

const Body = z.object({
  title: z.string().min(0).max(32),
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
      { error: 'invalid_body', message: 'title 不能超过 32 个字符' },
      { status: 400 },
    );
  }

  setAppTitle(parsed.data.title);
  return NextResponse.json({ ok: true });
}
