// PUT /api/notes/batch-tags — batch-add/remove tags on multiple notes.
//
// Body: { noteIds: string[], addTags?: string[], removeTags?: string[] }
// Response: { data: { updated: number } }

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { batchUpdateNoteTags } from '@/lib/notes/queries';

export const runtime = 'nodejs';

const BatchTagBody = z.object({
  noteIds: z.array(z.string().min(1)).min(1).max(200),
  addTags: z.array(z.string().min(1).max(100)).max(50).optional(),
  removeTags: z.array(z.string().min(1).max(100)).max(50).optional(),
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

  const parsed = BatchTagBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = batchUpdateNoteTags({
      noteIds: parsed.data.noteIds,
      addTags: parsed.data.addTags ?? [],
      removeTags: parsed.data.removeTags ?? [],
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[notes/batch-tags] PUT failed:', err);
    return NextResponse.json(
      { error: 'batch_tags_failed', message: 'Failed to batch-update tags' },
      { status: 500 },
    );
  }
}
