// PUT /api/notes/:id/tags — replace the entire tag set on a note.
//
// We expose a dedicated endpoint (rather than going through the general
// PUT /api/notes/:id) because callers like the AI auto-tag confirm UI
// have the note id and the desired tag list, but not the full title /
// contentJson / contentText that the general update body requires.
//
// The server still normalizes (lowercase, trim, dedupe) via setNoteTags,
// so callers can pass loose input.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { getNote, setNoteTags } from '@/lib/notes/queries';

export const runtime = 'nodejs';

const Body = z.object({
  tags: z.array(z.string().min(1).max(100)).max(50),
});

interface RouteContext {
  params: { id: string };
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const note = getNote(params.id);
  if (!note) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
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
    setNoteTags(params.id, parsed.data.tags);
    return NextResponse.json({ data: { tags: parsed.data.tags } });
  } catch (err) {
    console.error('[notes/:id/tags] PUT failed:', err);
    return NextResponse.json(
      { error: 'tags_failed', message: 'Failed to update tags' },
      { status: 500 },
    );
  }
}
