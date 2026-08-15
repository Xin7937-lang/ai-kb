// /api/settings/agent-api-token — manage the LAN-agent bearer token
// (ticket 11). Three verbs:
//
//   GET    → returns { data: { configured, createdAt } }. Never the raw
//             token, never the hash.
//   PUT    → (re)generates the token. Returns the RAW token in
//             { data: { token, createdAt } }. The user MUST copy it now —
//             the server discards the raw form immediately and stores
//             only the hash.
//   DELETE → clears the stored hash. Bearer auth stops working for any
//             previously-issued token immediately.
//
// All three require a real session (cookie OR bearer). The bearer path
// is intentionally allowed here so a LAN agent can rotate its OWN
// credential — but note that rotating invalidates the current token,
// including the one in the Authorization header of this very request,
// so the response is the last thing that token will authenticate.

import { NextResponse, type NextRequest } from 'next/server';

import { getSession } from '@/lib/auth/session';
import {
  clearAgentApiToken,
  getAgentApiTokenStatus,
  setAgentApiTokenHash,
} from '@/lib/auth/init';
import {
  generateAgentApiToken,
  hashAgentApiToken,
} from '@/lib/auth/api-token';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ data: getAgentApiTokenStatus() });
}

export async function PUT(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const raw = generateAgentApiToken();
  const hash = hashAgentApiToken(raw);
  setAgentApiTokenHash(hash);
  const status = getAgentApiTokenStatus();
  return NextResponse.json({
    data: {
      token: raw,
      createdAt: status.createdAt,
    },
  });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  clearAgentApiToken();
  return NextResponse.json({ data: { cleared: true } });
}
