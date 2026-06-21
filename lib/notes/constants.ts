// Pure constants shared between server and client code.
//
// IMPORTANT: This file MUST NOT import anything that pulls Node-only
// modules (better-sqlite3, fs, path, etc.) into the client bundle.
// Client components import `FAVORITES_TAG_NAME` from here; if we ever
// add a runtime dep, we'll break `next build` with
// "Module not found: Can't resolve 'fs'".
//
// Server-only constants (DB types, query helpers, etc.) live in
// `queries.ts` as before.

/**
 * Canonical name of the built-in favorites tag. Stored verbatim —
 * Chinese has no case folding, so the normalization step in
 * `setNoteTags` is a no-op for this string. Reference this constant
 * anywhere "收藏" appears in code (sidebar hint, settings page text,
 * client component toggles) so the wording stays consistent.
 */
export const FAVORITES_TAG_NAME = '收藏';

/**
 * Default top-level tags for the knowledge-management taxonomy.
 * Seeded by migration v7. Order matters: matches position 0-4.
 */
export const DEFAULT_TAGS = ['输入', '思考', '输出', '资料', '归档'] as const;

/**
 * Tag automatically applied to newly-imported notes when they carry
 * no explicit tags from the import source.
 */
export const DEFAULT_IMPORT_TAG = '输入';

/**
 * Sentinel id used in the URL (?tag=-1) to represent the "untagged notes"
 * filter. Must be negative so it never collides with a real tag id.
 */
export const UNTAGGED_FILTER_ID = -1;
