// Disk-side of the image upload flow. The HTTP route in `app/api/uploads`
// hands us an already-decoded buffer; we own validation, layout, and the
// `assets` DB row.
//
// Layout: ${UPLOADS_DIR}/YYYY/MM/<nanoid16>.<ext> -- year/month bucketing
// keeps directory counts bounded, and the nanoid is the file's content
// address (effectively immutable from the outside), which lets us set a
// one-year `Cache-Control: immutable` header on the static-serve route.
//
// `note_id` is intentionally NULL at upload time: we don't know which
// note the image will end up in (the user might upload before the note
// is even saved). The note-save flow leaves the row null -- the asset
// is referenced by URL inside the editor JSON, and the DB row is only
// a soft-record for future backup / restore tooling.

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import { UPLOADS_DIR } from '@/lib/env';
import { getDb } from '@/lib/db/client';
import { extForMime } from './mime';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export class UploadValidationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'UploadValidationError';
    this.code = code;
    this.status = status;
  }
}

export type SaveUploadResult = {
  id: string;
  relPath: string;
  url: string;
  mime: string;
  size: number;
};

export async function saveUpload(
  buffer: Buffer,
  originalName: string,
  mime: string,
): Promise<SaveUploadResult> {
  if (!Buffer.isBuffer(buffer)) {
    throw new UploadValidationError('invalid_body', 'file payload missing', 400);
  }
  if (!mime || !mime.startsWith('image/')) {
    throw new UploadValidationError(
      'unsupported_media_type',
      'Only image/* uploads are accepted',
      415,
    );
  }
  if (buffer.length === 0) {
    throw new UploadValidationError('empty_file', 'Uploaded file is empty', 400);
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      'payload_too_large',
      `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`,
      413,
    );
  }

  const ext = extForMime(mime);
  if (!ext) {
    throw new UploadValidationError(
      'unsupported_media_type',
      `Unsupported image type: ${mime}`,
      415,
    );
  }

  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const id = nanoid(16);
  const relPath = path.join(year, month, `${id}${ext}`);
  const absDir = path.join(UPLOADS_DIR, year, month);

  if (!existsSync(absDir)) {
    await mkdir(absDir, { recursive: true });
  }

  const absPath = path.join(absDir, `${id}${ext}`);
  await writeFile(absPath, buffer);

  // Soft-record the upload. note_id is NULL by design -- see file header.
  getDb()
    .prepare(
      'INSERT INTO assets (id, note_id, rel_path, mime, size, created_at) ' +
        'VALUES (?, NULL, ?, ?, ?, ?)',
    )
    .run(id, relPath, mime, buffer.length, now.getTime());

  return {
    id,
    relPath,
    url: `/uploads/${relPath.split(path.sep).join('/')}`,
    mime,
    size: buffer.length,
  };
}
