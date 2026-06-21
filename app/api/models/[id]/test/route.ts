// /api/models/[id]/test — POST to probe whether a stored model config can
// reach its provider. Returns { ok, error? }; never throws.

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { testModelConnection } from '@/lib/ai/test';
import { NoSuchModelError } from '@/lib/ai/errors';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await testModelConnection(params.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NoSuchModelError) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    console.error('[models.test] unexpected error:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 },
    );
  }
}
