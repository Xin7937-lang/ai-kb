#!/usr/bin/env tsx
// scripts/build-md-payload.ts
//
// Build a JSON payload suitable for `POST /api/notes` with the
// `contentMarkdown` field. Avoids the jq-on-Windows pain we hit
// during the CLAUDE.md upload test by doing all string handling in
// Node where \r\n / quoting / Unicode are well-behaved.
//
// Usage:
//   npx tsx scripts/build-md-payload.ts <md-file> [title] [--tags a,b,c] [-o out.json]
//
// Behavior:
//   - Reads <md-file> as UTF-8.
//   - Title defaults to the first `# heading` line in the file (or the
//     filename's basename without extension if no heading is found).
//   - Tags default to []; pass --tags a,b,c to set.
//   - Writes the payload to -o (default ./tmp/md-payload.json) and prints
//     the path + sizes so the caller can pipe straight into curl.

import { readFileSync, writeFileSync } from 'fs';
import { basename, extname, resolve } from 'path';

type CliOptions = {
  input: string;
  title?: string;
  tags: string[];
  outFile: string;
};

function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  let tags: string[] = [];
  let outFile = 'tmp/md-payload.json';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tags') {
      const val = argv[++i];
      if (!val) throw new Error('--tags requires a value');
      tags = val
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (arg === '-o' || arg === '--out') {
      outFile = argv[++i];
      if (!outFile) throw new Error(`${arg} requires a value`);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length < 1) {
    throw new Error(
      'usage: build-md-payload <md-file> [title] [--tags a,b,c] [-o out.json]',
    );
  }

  return {
    input: positional[0],
    title: positional[1],
    tags,
    outFile,
  };
}

function defaultTitle(md: string, filePath: string): string {
  // Look for the first ATX heading (#, ##, ###...).
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m && m[1]) return m[1].trim();
  }
  // Fallback: filename without extension.
  const base = basename(filePath, extname(filePath));
  return base;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = resolve(process.cwd(), opts.input);
  const md = readFileSync(inputPath, 'utf8');
  const title = opts.title ?? defaultTitle(md, opts.input);

  const payload = {
    title,
    contentMarkdown: md,
    tags: opts.tags,
  };

  const outPath = resolve(process.cwd(), opts.outFile);
  writeFileSync(outPath, JSON.stringify(payload));

  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  console.log(
    `wrote ${outPath}  title="${title}"  md_chars=${md.length}  payload_bytes=${payloadBytes}  tags=${JSON.stringify(opts.tags)}`,
  );
}

try {
  main();
} catch (err) {
  console.error('[build-md-payload]', (err as Error).message);
  process.exit(1);
}