// POST /api/uploads -- authenticated multipart image upload.

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { saveUpload, UploadValidationError } from '@/lib/storage/uploads';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'invalid_multipart', message },
      { status: 400 },
    );
  }

  const entry = form.get('file');
  if (!(entry instanceof File)) {
    return NextResponse.json(
      { error: 'missing_file', message: 'multipart field "file" is required' },
      { status: 400 },
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await entry.arrayBuffer());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[uploads.POST] failed to read multipart file:', err);
    return NextResponse.json(
      { error: 'invalid_file', message },
      { status: 400 },
    );
  }

  try {
    const saved = await saveUpload(buffer, entry.name, entry.type);
    return NextResponse.json(
      {
        data: {
          url: saved.url,
          assetId: saved.id,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof UploadValidationError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status },
      );
    }
    console.error('[uploads.POST] failed to save upload:', err);
    return NextResponse.json(
      { error: 'upload_failed', message: 'Image upload failed' },
      { status: 500 },
    );
  }
}
