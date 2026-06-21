// GET  /api/tags — list tags with usage counts
// POST /api/tags — create a new tag (optionally as a child of another)
// PUT  /api/tags — batch rename / merge tags
//                 body: { renames: { from: string, to: string }[] }

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { listTagsWithCount, renameTags, createTag } from '@/lib/notes/queries';

export const runtime = 'nodejs';

const PostBody = z.object({
  name: z.string().min(1).max(100),
  parentId: z.number().int().positive().nullable().optional(),
});

const RenameSchema = z.object({
  from: z.string().min(1).max(100),
  to: z.string().max(100), // empty string is allowed (= delete)
});

const PutBody = z.object({
  renames: z.array(RenameSchema).max(200),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ data: listTagsWithCount() });
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

  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'name 必填，1-100 字符' },
      { status: 400 },
    );
  }

  try {
    const tag = createTag(parsed.data.name, parsed.data.parentId ?? null);
    return NextResponse.json({ data: tag }, { status: 201 });
  } catch (err) {
    console.error('[tags] POST failed:', err);
    return NextResponse.json(
      { error: 'create_failed', message: 'Failed to create tag' },
      { status: 500 },
    );
  }
}

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

  const parsed = PutBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const tags = renameTags(parsed.data.renames);
    return NextResponse.json({ data: tags });
  } catch (err) {
    console.error('[tags] PUT failed:', err);
    return NextResponse.json(
      { error: 'rename_failed', message: 'Failed to rename tags' },
      { status: 500 },
    );
  }
}
