// POST /api/tags/delete — batch delete tags by id.
//
// Body: { ids: number[] }
// Response: 200 { data: { deleted, skipped, tags } }
//
// Built-in tags (currently just 收藏) are silently skipped, returned
// in the `skipped` array so the UI can surface a friendly message.
// `note_tags` join rows are cleaned automatically by the ON DELETE
// CASCADE on that table's foreign key.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { deleteTagsByIds, listTagsWithCount } from '@/lib/notes/queries';

export const runtime = 'nodejs';

const Body = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
});

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

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = deleteTagsByIds(parsed.data.ids);
    return NextResponse.json({
      data: {
        deleted: result.deletedIds.length,
        skipped: result.skipped,
        missing: result.missing,
        tags: listTagsWithCount(),
      },
    });
  } catch (err) {
    console.error('[tags/delete] failed:', err);
    return NextResponse.json(
      { error: 'delete_failed', message: 'Failed to delete tags' },
      { status: 500 },
    );
  }
}
