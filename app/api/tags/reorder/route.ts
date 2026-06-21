// PUT /api/tags/reorder — set the sidebar order of tags.
//
// Body: { order: number[] }   // tag ids, top-of-sidebar first
//
// Semantics: positions 0, 1, 2, ... are written in the order given.
// Tags not present in the array keep their current position. Duplicate
// ids are deduped (last occurrence wins) inside `setTagsPositions`.
//
// Returns the refreshed tag list so the client can re-render without
// a second roundtrip.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  listTagsWithCount,
  setTagsPositions,
} from '@/lib/notes/queries';

export const runtime = 'nodejs';

const Body = z.object({
  order: z.array(z.number().int().positive()).min(1).max(500),
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
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    setTagsPositions(parsed.data.order);
    return NextResponse.json({ data: listTagsWithCount() });
  } catch (err) {
    console.error('[tags/reorder] failed:', err);
    return NextResponse.json(
      { error: 'reorder_failed', message: 'Failed to reorder tags' },
      { status: 500 },
    );
  }
}
