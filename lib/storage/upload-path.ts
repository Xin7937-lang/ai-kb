import path from 'path';

/**
 * Resolve a public upload path without allowing it to escape the upload root.
 * Returns null for an empty path or any traversal attempt.
 */
export function resolveUploadPath(
  uploadRoot: string,
  segments: readonly string[],
): string | null {
  if (segments.length === 0) return null;

  const root = path.resolve(uploadRoot);
  const target = path.resolve(root, ...segments);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return target;
}
