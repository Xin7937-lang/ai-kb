// GET    /api/chat/conversations/[id] — get a single conversation with messages.
// POST   /api/chat/conversations/[id] — save a complete turn (user + assistant).
// DELETE /api/chat/conversations/[id] — delete a single conversation.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  getConversation,
  deleteConversation,
  saveConversationTurn,
} from '@/lib/chat/queries';

export const runtime = 'nodejs';

const TurnBody = z.object({
  userContent: z.string().min(1).max(8000),
  assistantContent: z.string().min(0).max(32000),
  sources: z
    .array(z.object({ id: z.string(), title: z.string() }))
    .optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const conv = getConversation(params.id);
  if (!conv) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ data: conv });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = TurnBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'userContent 和 assistantContent 必填' },
      { status: 400 },
    );
  }

  const conv = getConversation(params.id);
  if (!conv) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { userMsg, assistantMsg } = saveConversationTurn(
    params.id,
    parsed.data.userContent,
    parsed.data.assistantContent,
    parsed.data.sources ?? null,
  );

  return NextResponse.json({ data: { userMsg, assistantMsg } }, { status: 201 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const deleted = deleteConversation(params.id);
  if (!deleted) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ data: { deleted: true } });
}
