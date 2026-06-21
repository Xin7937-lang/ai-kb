// GET    /api/notes/:id  — fetch one note (full content + tags)
// PUT    /api/notes/:id  — update title/content/tags (FTS auto-sync, sets summary_state='stale' on content change)
// DELETE /api/notes/:id  — remove a note (cascades)

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  deleteNote,
  getNote,
  updateNote,
  type NoteFull,
} from '@/lib/notes/queries';

export const runtime = 'nodejs';

const TiptapDocSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

const UpdateNoteBody = z.object({
  title: z.string().min(1).max(500),
  contentJson: TiptapDocSchema,
  contentText: z.string().max(200_000).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(),
});

interface RouteContext {
  params: { id: string };
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(
  _request: NextRequest,
  { params }: RouteContext,
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const note: NoteFull | null = getNote(params.id);
  if (!note) return notFound();
  return NextResponse.json({ data: note });
}

export async function PUT(
  request: NextRequest,
  { params }: RouteContext,
) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = UpdateNoteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const note = await updateNote(params.id, {
      title: parsed.data.title,
      contentJson: parsed.data.contentJson as Parameters<
        typeof updateNote
      >[1]['contentJson'],
      contentText: parsed.data.contentText,
      tags: parsed.data.tags,
    });
    if (!note) return notFound();
    return NextResponse.json({ data: note });
  } catch (err) {
    console.error('[notes] PUT failed:', err);
    return NextResponse.json(
      { error: 'update_failed', message: 'Failed to update note' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext,
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const ok = deleteNote(params.id);
  if (!ok) return notFound();
  return new NextResponse(null, { status: 204 });
}
