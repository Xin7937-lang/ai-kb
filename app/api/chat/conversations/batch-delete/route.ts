// POST /api/chat/conversations/batch-delete — delete multiple conversations.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { deleteConversations } from '@/lib/chat/queries';

export const runtime = 'nodejs';

const Body = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'ids 至少 1 个，最多 100 个' },
      { status: 400 },
    );
  }

  const deletedCount = deleteConversations(parsed.data.ids);
  return NextResponse.json({ data: { deletedCount } });
}
