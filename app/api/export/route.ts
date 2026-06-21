// GET /api/export
//
//   * `?scope=note&id=<noteId>`  → single-note zip (note.md + meta.json + images/)
//   * `?scope=all`                → full backup zip (kb-<ts>.db + uploads/ + manifest.json)
//
// The response is a binary stream; we set Content-Disposition so browsers
// download it. We always return `application/zip` — there's no JSON error
// path for the streaming case (we still JSON-error on the early validation
// failures).

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getNote } from '@/lib/notes/queries';
import {
  createFullBackupZip,
  createSingleNoteZip,
  formatTimestamp,
} from '@/lib/storage/archive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: 'bad_request', message }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const scope = url.searchParams.get('scope');
  const id = url.searchParams.get('id');

  if (scope === 'note') {
    if (!id) return badRequest('scope=note requires id');
    const note = getNote(id);
    if (!note) return notFound();
    try {
      const buf = await createSingleNoteZip(note);
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: zipHeaders(`${note.id}.zip`),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[export] single-note failed:', err);
      return NextResponse.json(
        { error: 'export_failed', message: msg },
        { status: 500 },
      );
    }
  }

  if (scope === 'all' || scope === null) {
    try {
      const buf = await createFullBackupZip();
      const filename = `kb-backup-${formatTimestamp()}.zip`;
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: zipHeaders(filename),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[export] full backup failed:', err);
      return NextResponse.json(
        { error: 'export_failed', message: msg },
        { status: 500 },
      );
    }
  }

  return badRequest(`unknown scope: ${scope}`);
}

function zipHeaders(filename: string): HeadersInit {
  return {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  };
}
