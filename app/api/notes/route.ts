// GET  /api/notes  — list notes (search, tag filter, pagination)
// POST /api/notes  — create a new note

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { createNote, listNotes } from '@/lib/notes/queries';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// We accept `contentJson` as `unknown` and validate its shape minimally — the
// full TipTap JSON schema is too loose to constrain usefully with Zod, but we
// do require it to be a non-null object with a `type` field.
const TiptapDocSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

const CreateNoteBody = z.object({
  title: z.string().min(1).max(500),
  contentJson: TiptapDocSchema,
  contentText: z.string().max(200_000).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(),
});

const ListQuery = z.object({
  q: z.string().min(1).max(500).optional(),
  tag: z
    .string()
    .regex(/^\d+$/, 'tag must be a numeric id')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = ListQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_query', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const tagId =
    parsed.data.tag !== undefined ? Number.parseInt(parsed.data.tag, 10) : undefined;
  if (parsed.data.tag !== undefined && !Number.isFinite(tagId)) {
    return NextResponse.json({ error: 'invalid_tag' }, { status: 400 });
  }

  const result = listNotes({
    q: parsed.data.q,
    tagId,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
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

  const parsed = CreateNoteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const note = await createNote({
      title: parsed.data.title,
      // The Zod schema guarantees a `type` field; cast to JSONContent.
      contentJson: parsed.data.contentJson as Parameters<
        typeof createNote
      >[0]['contentJson'],
      contentText: parsed.data.contentText,
      tags: parsed.data.tags,
    });
    return NextResponse.json({ data: note }, { status: 201 });
  } catch (err) {
    console.error('[notes] POST failed:', err);
    return NextResponse.json(
      { error: 'create_failed', message: 'Failed to create note' },
      { status: 500 },
    );
  }
}
