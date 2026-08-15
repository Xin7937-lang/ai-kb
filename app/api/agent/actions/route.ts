// GET /api/agent/actions -- audit history for the agent tools
// (ticket 04). Lists agent_actions rows newest-first, with optional
// pagination and conversation-id filtering. Response shape matches
// the project's `{ data | error }` convention.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/lib/auth/session';
import { listAgentActions } from '@/lib/ai/tools/agent-audit';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional(),
  offset: z.coerce.number().int().min(0).optional(),
  conversationId: z.string().min(1).max(64).optional(),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_query',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      },
      { status: 400 },
    );
  }

  const rows = listAgentActions(parsed.data);
  return NextResponse.json({ data: rows });
}