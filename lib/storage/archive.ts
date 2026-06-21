// S6 -- zip archive helpers for importing and exporting notes.
//
// We use `archiver` (streaming writer) to produce zips and `unzipper`
// (random-access reader) to inspect uploaded zips. Both are already in
// `package.json`, so we don't pull in new dependencies.
//
// All paths go through Node's `path` module; no string concatenation.
// We rely on `archiver-utils`' built-in normalization to keep archive
// entry names portable (always forward slashes).

import { PassThrough } from 'stream';
import path from 'path';
import { promises as fsp, createReadStream, existsSync, statSync } from 'fs';
import archiver from 'archiver';
import unzipper from 'unzipper';

import { BACKUPS_DIR, DB_PATH, UPLOADS_DIR } from '@/lib/env';
import type { NoteFull } from '@/lib/notes/queries';
import { tiptapToMarkdown } from '@/lib/notes/markdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A `note` import is what `createSingleNoteZip` produces: a single note
 * exported as `note.md` + `meta.json` (with optional `images/` folder).
 */
export type NoteImportEntry = {
  md: string;
  meta: {
    id: string;
    title?: string;
    tags?: string[];
    createdAt?: number;
    updatedAt?: number;
    summary?: string | null;
  };
};

/**
 * A `md` import is a free-form collection of .md / .txt files. We infer
 * the title from the first heading or the filename.
 */
export type MdImportEntry = {
  md: string;
  name: string;
};

export type ExtractedZip =
  | { kind: 'note'; files: NoteImportEntry[] }
  | { kind: 'md'; files: MdImportEntry[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Drain an archiver stream into a single Buffer. The caller passes a
 * `builder` callback that performs ALL `archive.append` / `archive.file`
 * / `archive.directory` calls; we pipe + finalize only after the builder
 * resolves. This avoids the "queue closed" error you get when you
 * append to an archive after `finalize()` has been called.
 *
 * The `builder` is async so callers can do async work (e.g. VACUUM
 * INTO) before adding entries.
 */
function archiveToBuffer(
  builder: (archive: archiver.Archiver) => Promise<void>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    archive.on('warning', (err) => {
      // Non-fatal archiver warnings (e.g. ENOENT during stat) -- log
      // and continue; the stream `end` / `error` events will still fire.
      console.warn('[archive] warning:', err.message);
    });
    archive.pipe(sink);

    (async () => {
      try {
        await builder(archive);
        await archive.finalize();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

/**
 * Format a Date as `YYYYMMDD-HHMMSS` in local time -- used in filenames.
 */
export function formatTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Walk a TipTap JSON doc and collect every image `src` attribute. The
 * result is de-duplicated. Paths that look absolute or contain a scheme
 * are returned as-is; everything else is treated as relative to
 * UPLOADS_DIR.
 */
function collectImageRefs(doc: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: string;
      attrs?: Record<string, unknown>;
      content?: unknown[];
    };
    if (n.type === 'image' && n.attrs && typeof n.attrs['src'] === 'string') {
      const src = n.attrs['src'];
      if (src && !seen.has(src)) {
        seen.add(src);
        out.push(src);
      }
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) visit(child);
    }
  }
  visit(doc);
  return out;
}

/**
 * Resolve an image src from a TipTap doc to an absolute file path on disk.
 *
 *   - Absolute paths and URLs (http/https/data:) are returned as-is.
 *   - Public URL prefix `/uploads/...` -- strip the prefix and join with
 *     UPLOADS_DIR.
 *   - Bare relative paths -- joined with UPLOADS_DIR.
 */
function resolveImagePath(src: string): string | null {
  if (!src) return null;
  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(src)) {
    // scheme: (e.g. http:, data:, file:) or protocol-relative -- skip
    return null;
  }
  let rel = src;
  if (rel.startsWith('/uploads/')) {
    rel = rel.slice('/uploads/'.length);
  }
  // Sanitize: prevent zip slip / arbitrary reads.
  if (rel.includes('..')) return null;
  return path.join(UPLOADS_DIR, rel);
}

// ---------------------------------------------------------------------------
// createSingleNoteZip
// ---------------------------------------------------------------------------

/**
 * Build a zip for a single note. Contents:
 *   - `note.md`       -- Markdown rendering of the note (with title heading)
 *   - `meta.json`     -- note metadata (id, tags, timestamps, optional summary)
 *   - `images/...`    -- referenced image files copied from UPLOADS_DIR,
 *                        when present. Missing files are skipped with a
 *                        warning.
 */
export async function createSingleNoteZip(note: NoteFull): Promise<Buffer> {
  return archiveToBuffer(async (archive) => {
    const md =
      `# ${note.title || 'Untitled note'}\n\n` +
      tiptapToMarkdown(note.contentJson);
    archive.append(md, { name: 'note.md' });

    const meta = {
      id: note.id,
      title: note.title,
      tags: note.tags,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      summary: note.summary ?? null,
    };
    archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' });

    const imageRefs = collectImageRefs(note.contentJson);
    for (const src of imageRefs) {
      const abs = resolveImagePath(src);
      if (!abs) continue;
      if (!existsSync(abs)) {
        console.warn(`[archive] image missing for export: ${src}`);
        continue;
      }
      const rel = src.startsWith('/uploads/')
        ? src.slice('/uploads/'.length)
        : src;
      archive.file(abs, { name: `images/${rel}` });
    }
  });
}

// ---------------------------------------------------------------------------
// createFullBackupZip
// ---------------------------------------------------------------------------

/**
 * Build a full backup zip. Contents:
 *   - `kb-<timestamp>.db`   -- clean SQLite snapshot (via VACUUM INTO)
 *   - `uploads/...`         -- recursive copy of the UPLOADS_DIR tree
 *   - `manifest.json`       -- version, createdAt, noteCount, schemaVersion
 */
export async function createFullBackupZip(): Promise<Buffer> {
  return archiveToBuffer(async (archive) => {
    // Lazy import to avoid pulling better-sqlite3 into the route module
    // graph before the runtime is up.
    const { getDb } = await import('@/lib/db/client');
    const db = getDb();

    // VACUUM INTO wants a single quoted SQL string literal. The path can
    // in theory contain a single quote -- escape it (SQL standard: double-up).
    const ts = formatTimestamp();
    const snapshotFilename = `kb-${ts}.db`;
    const snapshotPath = path.join(BACKUPS_DIR, snapshotFilename);
    await fsp.mkdir(BACKUPS_DIR, { recursive: true });

    const escaped = snapshotPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);

    // 1. SQLite snapshot
    archive.file(snapshotPath, { name: snapshotFilename });

    // 2. uploads/ tree. Directory() with the UPLOADS_DIR as the source
    // root copies the whole folder including its children; we re-prefix
    // the entries with `uploads/` so the unzip side can extract verbatim.
    if (existsSync(UPLOADS_DIR) && statSync(UPLOADS_DIR).isDirectory()) {
      archive.directory(UPLOADS_DIR, 'uploads');
    }

    // 3. manifest.json
    const noteCount =
      (
        db
          .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM notes')
          .get() ?? { c: 0 }
      ).c;
    const schemaVersionRow = db
      .prepare<[], { version: number }>(
        'SELECT MAX(version) AS version FROM _migrations',
      )
      .get();
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      noteCount,
      schemaVersion: schemaVersionRow?.version ?? 1,
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  });
}

// ---------------------------------------------------------------------------
// extractAndParseZip
// ---------------------------------------------------------------------------

const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const TEXT_EXT = new Set(['.txt']);

/**
 * Inspect an uploaded zip and classify it as a `note` zip (contains
 * `note.md` + `meta.json` pairs) or a `md` zip (free-form .md/.txt files).
 * Backups (containing a `kb-*.db`) are detected and surface as an error
 * -- backup restore is out of scope for MVP.
 */
export async function extractAndParseZip(buffer: Buffer): Promise<ExtractedZip> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('empty buffer');
  }
  let directory;
  try {
    directory = await unzipper.Open.buffer(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`not a valid zip: ${msg}`);
  }
  const files = directory.files ?? [];

  // Backup detection -- short-circuit before doing any other work.
  const hasBackupDb = files.some(
    (f) => /^kb-.*\.db$/.test(basename(f.path)) && !f.path.includes('/'),
  );
  if (hasBackupDb) {
    throw new Error('backup_restore_not_supported');
  }

  // Note-zip detection: any `note.md` paired with a `meta.json` at the
  // same directory level counts as one (or more) note entries. We only
  // support the single-note layout for S6.
  const noteEntries: NoteImportEntry[] = [];
  for (const f of files) {
    if (f.path === 'note.md' && f.type === 'File') {
      const metaFile = files.find(
        (x) => x.path === 'meta.json' && x.type === 'File',
      );
      if (!metaFile) {
        throw new Error('note.md present but meta.json missing');
      }
      const mdBuf = await f.buffer();
      const metaBuf = await metaFile.buffer();
      let meta: NoteImportEntry['meta'];
      try {
        const parsed = JSON.parse(metaBuf.toString('utf8')) as Record<
          string,
          unknown
        >;
        meta = {
          id: typeof parsed['id'] === 'string' ? (parsed['id'] as string) : '',
          title:
            typeof parsed['title'] === 'string'
              ? (parsed['title'] as string)
              : undefined,
          tags: Array.isArray(parsed['tags'])
            ? (parsed['tags'] as unknown[]).filter(
                (t): t is string => typeof t === 'string',
              )
            : undefined,
          createdAt:
            typeof parsed['createdAt'] === 'number'
              ? (parsed['createdAt'] as number)
              : undefined,
          updatedAt:
            typeof parsed['updatedAt'] === 'number'
              ? (parsed['updatedAt'] as number)
              : undefined,
          summary:
            typeof parsed['summary'] === 'string' || parsed['summary'] === null
              ? (parsed['summary'] as string | null)
              : undefined,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`meta.json is not valid JSON: ${msg}`);
      }
      noteEntries.push({ md: mdBuf.toString('utf8'), meta });
      break; // only the first note.md is honoured for S6
    }
  }
  if (noteEntries.length > 0) {
    return { kind: 'note', files: noteEntries };
  }

  // MD-zip fallback: collect every .md / .txt file at the top level.
  const mdFiles: MdImportEntry[] = [];
  for (const f of files) {
    if (f.type !== 'File') continue;
    const name = basename(f.path);
    if (!name || f.path.includes('/')) continue; // ignore nested files
    const ext = path.extname(name).toLowerCase();
    if (!MD_EXT.has(ext) && !TEXT_EXT.has(ext)) continue;
    const buf = await f.buffer();
    mdFiles.push({ md: buf.toString('utf8'), name });
  }
  if (mdFiles.length === 0) {
    throw new Error('zip contains no importable files');
  }
  return { kind: 'md', files: mdFiles };
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? p : p.slice(i + 1);
}
