// Tiny extension → mime lookup for the image types we accept on upload.
// Anything not in this table is treated as `application/octet-stream` by the
// static-serve route (browsers won't render it inline, but the download will
// still work). Adding more types is a one-liner; the table is intentionally
// scoped to images so we don't accidentally widen attack surface.

const TABLE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export function mimeForPath(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return TABLE[ext] ?? 'application/octet-stream';
}

/**
 * Canonical extension we write to disk for a given mime type. Returns an
 * empty string if the mime is not one we know how to store.
 */
export function extForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '';
  }
}
