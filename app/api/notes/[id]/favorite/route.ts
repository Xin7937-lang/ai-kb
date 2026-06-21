// POST /api/notes/:id/favorite — toggle the built-in 收藏 (favorites)
// tag on a single note. Idempotent in spirit: each call flips the
// membership, so the client can render the same star button for both
// "add to favorites" and "remove from favorites" actions.
//
// Returns the new favorited state and the favorites tag id (so the
// client can update its UI without a second roundtrip).
//
//   { data: { favorited: true,  favoriteTagId: 7 } }

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { toggleNoteFavorite } from '@/lib/notes/queries';

export const runtime = 'nodejs';

interface RouteContext {
  params: { id: string };
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = toggleNoteFavorite(params.id);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof Error && err.message === 'note_not_found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    console.error('[favorite] failed:', err);
    return NextResponse.json(
      { error: 'favorite_failed', message: 'Failed to toggle favorite' },
      { status: 500 },
    );
  }
}
