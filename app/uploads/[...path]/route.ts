// GET /uploads/* -- public immutable image serving.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { UPLOADS_DIR } from '@/lib/env';
import { mimeForPath } from '@/lib/storage/mime';
import { resolveUploadPath } from '@/lib/storage/upload-path';

export const runtime = 'nodejs';

type FileSystemError = {
  code?: unknown;
};

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as FileSystemError).code;
  return typeof code === 'string' ? code : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const filePath = resolveUploadPath(UPLOADS_DIR, params.path);
  if (!filePath) {
    return new NextResponse('Not found', { status: 404 });
  }

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ENOENT' || code === 'EISDIR') {
      return new NextResponse('Not found', { status: 404 });
    }
    console.error('[uploads.GET] failed to read image:', err);
    return new NextResponse('Image unavailable', { status: 500 });
  }

  const body = new ArrayBuffer(data.byteLength);
  new Uint8Array(body).set(data);

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': mimeForPath(path.basename(filePath)),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
