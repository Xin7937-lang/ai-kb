// POST /api/import — accept one or more .md / .txt / .zip files and
// create one row per note. Per-file failures are recorded in the
// response but never throw a 5xx — the route always returns 200 with
// `{ imported, errors, created }` so the client can render a partial
// success.
//
// Limits are deliberately small: the route is intended for personal use,
// not bulk loading of large corpora.

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { createNote, type NoteFull } from '@/lib/notes/queries';
import { markdownToTiptap } from '@/lib/notes/markdown';
import { extractAndParseZip } from '@/lib/storage/archive';
import { DEFAULT_IMPORT_TAG } from '@/lib/notes/constants';

export const runtime = 'nodejs';
// Imports of full ZIPs can be a few MB; bump the limit a bit.
export const maxDuration = 60;

type ImportError = { filename: string; message: string };
type ImportOneResult = {
  imported: number;
  errors: ImportError[];
  created: string[];
};

// Roughly 8 MB per file -- the same as a generous body limit; archiver +
// marked both are fine with this. The route-level body parser in Next.js
// applies its own limit too.
const MAX_BYTES = 8 * 1024 * 1024;

// Hard cap on how many files one request can carry. Prevents accidental
// "select 2000 files" from blowing up the worker.
const MAX_FILES = 50;

const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const TXT_EXT = new Set(['.txt']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name : name.slice(0, i);
}

/**
 * Best-effort title extraction. We look for a first non-empty heading line
 * (`# Foo`, `## Foo`, ...) or, failing that, use the filename without its
 * extension.
 */
function titleFromMarkdown(md: string, fallback: string): string {
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m && m[1]) return m[1].trim();
  }
  return fallback;
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: 'bad_request', message }, { status: 400 });
}

/**
 * Process a single file (either .md / .txt / .zip) and return per-file
 * results. A failure here is contained -- callers aggregate errors
 * across the batch.
 */
async function importOneFile(file: File): Promise<ImportOneResult> {
  const errors: ImportError[] = [];
  const created: NoteFull[] = [];
  const filename = file.name || 'untitled';

  if (file.size === 0) {
    return {
      imported: 0,
      errors: [{ filename, message: '文件为空' }],
      created: [],
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      imported: 0,
      errors: [
        {
          filename,
          message: `文件过大: ${file.size} bytes (上限 ${MAX_BYTES})`,
        },
      ],
      created: [],
    };
  }

  const ext = extOf(filename);
  const buffer = Buffer.from(await file.arrayBuffer());

  // .zip branch: parse and import every contained note (note.md/meta.json
  // pair or free-form .md files).
  if (ext === '.zip') {
    let parsed;
    try {
      parsed = await extractAndParseZip(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        imported: 0,
        errors: [
          {
            filename,
            message: `zip 解析失败: ${msg}`,
          },
        ],
        created: [],
      };
    }

    // `parsed.kind` is the discriminator; entries themselves are
    // uniformly `{ md }` with optional `meta` (note kind) or `name` (md kind).
    const isNoteKind = parsed.kind === 'note';
    for (const entry of parsed.files) {
      // `name` only exists on MdImportEntry; guard with `in`.
      const entryName = isNoteKind
        ? 'note.md'
        : 'name' in entry
          ? entry.name
          : 'entry.md';
      try {
        const { contentJson, contentText } = markdownToTiptap(entry.md);
        const baseName =
          isNoteKind || !('name' in entry) ? 'note' : stripExt(entry.name);
        const fallback =
          isNoteKind || !('name' in entry)
            ? '导入的笔记'
            : baseName || '导入的笔记';
        // `meta` only exists on NoteImportEntry; use a type guard so
        // TypeScript can narrow the union.
        const explicitTitle =
          isNoteKind && 'meta' in entry && entry.meta?.title?.trim()
            ? entry.meta.title.trim()
            : null;
        const title = explicitTitle ?? titleFromMarkdown(entry.md, fallback);
        const explicitTags =
          isNoteKind && 'meta' in entry ? entry.meta?.tags ?? [] : [];
        // When no explicit tags, default to "输入"
        const tags =
          explicitTags.length > 0 ? explicitTags : [DEFAULT_IMPORT_TAG];
        const note = await createNote({
          title,
          contentJson,
          contentText,
          tags,
        });
        created.push(note);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ filename: entryName, message: msg });
      }
    }
    return {
      imported: created.length,
      errors,
      created: created.map((n) => n.id),
    };
  }

  // .md / .txt branch
  if (!MD_EXT.has(ext) && !TXT_EXT.has(ext)) {
    return {
      imported: 0,
      errors: [
        {
          filename,
          message: `不支持的文件类型: ${ext || '(无)'} (需要 .md / .txt / .zip)`,
        },
      ],
      created: [],
    };
  }

  const text = buffer.toString('utf8');
  try {
    const baseName = stripExt(filename) || '导入的笔记';
    const title = titleFromMarkdown(text, baseName);
    const { contentJson, contentText } =
      ext === '.txt' ? textToParagraphs(text) : markdownToTiptap(text);
    const note = await createNote({
      title,
      contentJson,
      contentText,
      tags: [DEFAULT_IMPORT_TAG],
    });
    return {
      imported: 1,
      errors: [],
      created: [note.id],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      imported: 0,
      errors: [{ filename, message: msg }],
      created: [],
    };
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return badRequest(`invalid multipart body: ${msg}`);
  }

  // Accept either a single `file` (legacy) or repeated `file` fields
  // (HTML <input multiple> sends one entry per chosen file).
  const files = form.getAll('file').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return badRequest('missing "file" field(s) in form data');
  }
  if (files.length > MAX_FILES) {
    return badRequest(
      `too many files: ${files.length} (上限 ${MAX_FILES})`,
    );
  }

  let totalImported = 0;
  const allErrors: ImportError[] = [];
  const allCreated: string[] = [];

  for (const file of files) {
    const result = await importOneFile(file);
    totalImported += result.imported;
    allErrors.push(...result.errors);
    allCreated.push(...result.created);
  }

  return NextResponse.json(
    {
      data: {
        imported: totalImported,
        files: files.length,
        errors: allErrors,
        created: allCreated,
      },
    },
    { status: 200 },
  );
}

/**
 * Render a plain text file as one TipTap paragraph per blank-line
 * block. Whitespace within a block is preserved.
 */
function textToParagraphs(text: string): {
  contentJson: {
    type: 'doc';
    content: Array<{ type: 'paragraph'; content?: Array<{ type: 'text'; text: string }> }>;
  };
  contentText: string;
} {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+$/g, '').replace(/^\s+/g, ''))
    .filter((s) => s.length > 0);
  const content =
    blocks.length > 0
      ? blocks.map((b) => ({
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: b }],
        }))
      : [{ type: 'paragraph' as const }];
  return {
    contentJson: { type: 'doc', content },
    contentText: blocks.join('\n\n'),
  };
}
