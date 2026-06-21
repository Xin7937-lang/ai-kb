// GET /api/chat/conversations — list all conversations (newest first).
// POST /api/chat/conversations — create a new empty conversation.

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { listConversations, createConversation } from '@/lib/chat/queries';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const data = listConversations();
  return NextResponse.json({ data });
}

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const conv = createConversation();
  return NextResponse.json({ data: conv }, { status: 201 });
}
