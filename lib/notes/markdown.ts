// Markdown ↔ TipTap conversion utilities used by S6 import/export.
//
// We use the `marked` library to turn Markdown into HTML, then walk the HTML
// with a small purpose-built tokenizer to produce a TipTap JSON document.
// We also support the reverse (minimal TipTap → Markdown) so a single note
// can be re-exported in a round-trippable way.
//
// Coverage (deliberately MVP — anything we don't recognise falls back to a
// text node so we never throw on weird input):
//
//   * Headings         # / ## / ###
//   * Paragraphs
//   * Bold / Italic    **text** / __text__ / *text* / _text_
//   * Inline code      `text`
//   * Code blocks      ```lang\n...\n```
//   * Bullet lists     - / *
//   * Ordered lists    1. / 1)
//   * Blockquotes      >
//   * Horizontal rules ---
//   * Links            [text](url)
//   * Images           ![alt](url)  (we only keep the URL — re-uploading
//                                     imported images is out of scope)
//
// The reverse converter (tiptapToMarkdown) only needs to round-trip the
// subset that we actually persist, so it can be much simpler.

import { marked } from 'marked';
import type { JSONContent } from '@tiptap/react';
import { extractText } from './text-extract';
import { EMPTY_TIPTAP_DOC } from './tiptap-init';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MarkdownToTiptapResult = {
  /** A TipTap document node that can be passed to createNote / updateNote. */
  contentJson: JSONContent;
  /** Plain-text rendering, suitable for FTS / summarization. */
  contentText: string;
};

// ---------------------------------------------------------------------------
// HTML tokenizer
// ---------------------------------------------------------------------------

type TokenBase = { start: number; end: number };
type Token =
  | ({ kind: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean } & TokenBase)
  | ({ kind: 'close'; name: string } & TokenBase)
  | ({ kind: 'text'; text: string } & TokenBase);

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*(\/?)>/g;

// HTML5 void elements — self-closing, no end tag.
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

// Block-level elements that establish a new top-level TipTap block.
const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'div', 'section', 'article',
]);

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|copy|reg);/g, (m) => ENTITY_MAP[m] ?? m);
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  const re = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    out[key] = decodeEntities(val);
  }
  return out;
}

function tokenizeHtml(html: string): Token[] {
  const tokens: Token[] = [];
  TAG_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    const [whole, closing, name, attrStr, selfSlash] = m;
    if (m.index > last) {
      tokens.push({ kind: 'text', text: html.slice(last, m.index), start: last, end: m.index });
    }
    const lower = name.toLowerCase();
    const attrs = parseAttrs(attrStr);
    const isVoid = VOID_ELEMENTS.has(lower);
    if (closing) {
      tokens.push({ kind: 'close', name: lower, start: m.index, end: m.index + whole.length });
    } else if (isVoid || selfSlash) {
      tokens.push({ kind: 'open', name: lower, attrs, selfClosing: true, start: m.index, end: m.index + whole.length });
    } else {
      tokens.push({ kind: 'open', name: lower, attrs, selfClosing: false, start: m.index, end: m.index + whole.length });
    }
    last = m.index + whole.length;
  }
  if (last < html.length) {
    tokens.push({ kind: 'text', text: html.slice(last), start: last, end: html.length });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Block walker
// ---------------------------------------------------------------------------

type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'code' }
  | { type: 'strike' }
  | { type: 'link'; attrs: { href: string } };

function marksSnapshot(stack: Mark[]): Mark[] {
  return stack.length === 0 ? [] : stack.map((m) =>
    m.type === 'link' ? { type: 'link', attrs: { href: m.attrs.href } } : { type: m.type },
  );
}

function findMatchingClose(tokens: Token[], startIdx: number, name: string): number {
  let depth = 1;
  for (let j = startIdx + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind === 'open' && t.name === name && !t.selfClosing) depth++;
    else if (t.kind === 'close' && t.name === name) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return tokens.length; // unterminated — consume the rest
}

function parseInlineTokens(tokens: Token[]): JSONContent[] {
  const stack: Mark[] = [];
  const out: JSONContent[] = [];
  let buf = '';
  let bufMarks: Mark[] = [];

  function flush() {
    if (buf.length === 0 && bufMarks.length === 0) return;
    if (buf.length > 0) {
      const node: JSONContent = { type: 'text', text: buf };
      if (bufMarks.length > 0) node.marks = bufMarks;
      out.push(node);
    }
    buf = '';
    bufMarks = [];
  }

  for (const t of tokens) {
    if (t.kind === 'text') {
      const decoded = decodeEntities(t.text);
      if (buf.length === 0) bufMarks = marksSnapshot(stack);
      buf += decoded;
      continue;
    }
    if (t.kind === 'open' && t.selfClosing) {
      if (t.name === 'br') {
        flush();
        out.push({ type: 'hardBreak' });
      } else if (t.name === 'img') {
        flush();
        out.push({ type: 'image', attrs: pickImgAttrs(t.attrs) });
      }
      continue;
    }
    if (t.kind === 'open') {
      switch (t.name) {
        case 'strong':
        case 'b':
          stack.push({ type: 'bold' });
          break;
        case 'em':
        case 'i':
          stack.push({ type: 'italic' });
          break;
        case 'code':
          stack.push({ type: 'code' });
          break;
        case 's':
        case 'del':
        case 'strike':
          stack.push({ type: 'strike' });
          break;
        case 'a': {
          const href = t.attrs['href'] ?? '';
          stack.push({ type: 'link', attrs: { href } });
          break;
        }
        default:
          // Unknown inline element — recurse so we don't lose its text.
          // (Currently we just drop the wrapper; keeping the text would
          // require pairing the open/close and emitting nested marks.)
          break;
      }
      continue;
    }
    if (t.kind === 'close') {
      switch (t.name) {
        case 'strong':
        case 'b': {
          const idx = [...stack].reverse().findIndex((m) => m.type === 'bold');
          if (idx >= 0) stack.splice(stack.length - 1 - idx, 1);
          break;
        }
        case 'em':
        case 'i': {
          const idx = [...stack].reverse().findIndex((m) => m.type === 'italic');
          if (idx >= 0) stack.splice(stack.length - 1 - idx, 1);
          break;
        }
        case 'code': {
          const idx = [...stack].reverse().findIndex((m) => m.type === 'code');
          if (idx >= 0) stack.splice(stack.length - 1 - idx, 1);
          break;
        }
        case 's':
        case 'del':
        case 'strike': {
          const idx = [...stack].reverse().findIndex((m) => m.type === 'strike');
          if (idx >= 0) stack.splice(stack.length - 1 - idx, 1);
          break;
        }
        case 'a': {
          const idx = [...stack].reverse().findIndex((m) => m.type === 'link');
          if (idx >= 0) stack.splice(stack.length - 1 - idx, 1);
          break;
        }
        default:
          break;
      }
    }
  }
  flush();
  return out;
}

function pickImgAttrs(attrs: Record<string, string>): { src: string; alt?: string; title?: string } {
  const out: { src: string; alt?: string; title?: string } = { src: attrs['src'] ?? '' };
  if (attrs['alt']) out.alt = attrs['alt'];
  if (attrs['title']) out.title = attrs['title'];
  return out;
}

function parseListItems(tokens: Token[]): JSONContent[] {
  const items: JSONContent[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === 'open' && t.name === 'li' && !t.selfClosing) {
      const closeIdx = findMatchingClose(tokens, i, 'li');
      const inner = tokens.slice(i + 1, closeIdx);
      const innerBlocks = parseBlocks(inner, 0);
      // TipTap requires listItem content to be a non-empty array of blocks;
      // an empty list item still needs a paragraph so the schema accepts it.
      const content = innerBlocks.length > 0 ? innerBlocks : [emptyParagraph()];
      items.push({ type: 'listItem', content });
      i = closeIdx + 1;
    } else {
      i++;
    }
  }
  return items;
}

function emptyParagraph(): JSONContent {
  return { type: 'paragraph' };
}

function parseBlocks(tokens: Token[], from: number): JSONContent[] {
  const out: JSONContent[] = [];
  let i = from;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === 'text') {
      if (!t.text.trim()) { i++; continue; }
      // Stray text becomes a paragraph.
      const end = findBlocksAtSameLevel(tokens, i, 'text');
      const inline = parseInlineTokens(tokens.slice(i, end));
      if (inline.length > 0) out.push({ type: 'paragraph', content: inline });
      i = end;
      continue;
    }
    if (t.kind === 'close') { i++; continue; }
    if (t.kind === 'open' && BLOCK_TAGS.has(t.name)) {
      if (t.name === 'hr' || (t.name === 'hr' && t.selfClosing)) {
        out.push({ type: 'horizontalRule' });
        i++;
        continue;
      }
      if (t.name === 'img' && t.selfClosing) {
        // Bare image at the top level — wrap in a paragraph so the doc stays
        // valid (TipTap's schema rejects block-level image nodes outside
        // of inline context).
        out.push({ type: 'paragraph', content: [{ type: 'image', attrs: pickImgAttrs(t.attrs) }] });
        i++;
        continue;
      }
      if (t.name === 'br' && t.selfClosing) {
        // stray <br> at block level — just skip
        i++;
        continue;
      }
      const closeIdx = findMatchingClose(tokens, i, t.name);
      const inner = tokens.slice(i + 1, closeIdx);
      const block = parseBlockTag(t.name, t.attrs, inner);
      if (block) out.push(block);
      i = closeIdx + 1;
      continue;
    }
    // Unknown open tag — skip it (and its close) so we don't loop forever.
    if (t.kind === 'open' && !t.selfClosing) {
      i = findMatchingClose(tokens, i, t.name) + 1;
      continue;
    }
    i++;
  }
  return out;
}

function findBlocksAtSameLevel(
  tokens: Token[],
  start: number,
  initialKind: 'text',
): number {
  // For stray text runs, consume until the next block tag starts.
  for (let j = start + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind === 'open' && BLOCK_TAGS.has(t.name) && !t.selfClosing) return j;
    if (t.kind === 'open' && (t.name === 'hr' || t.name === 'img') && t.selfClosing) return j;
  }
  return tokens.length;
}

function parseBlockTag(
  name: string,
  attrs: Record<string, string>,
  inner: Token[],
): JSONContent | null {
  if (/^h[1-6]$/.test(name)) {
    const level = Number(name[1]);
    const content = parseInlineTokens(inner);
    const node: JSONContent = { type: 'heading', attrs: { level } };
    if (content.length > 0) node.content = content;
    return node;
  }
  if (name === 'p') {
    const content = parseInlineTokens(inner);
    const node: JSONContent = { type: 'paragraph' };
    if (content.length > 0) node.content = content;
    return node;
  }
  if (name === 'ul' || name === 'ol') {
    const items = parseListItems(inner);
    if (items.length === 0) return null;
    return {
      type: name === 'ul' ? 'bulletList' : 'orderedList',
      content: items,
    };
  }
  if (name === 'blockquote') {
    const innerBlocks = parseBlocks(inner, 0);
    return {
      type: 'blockquote',
      content: innerBlocks.length > 0 ? innerBlocks : [emptyParagraph()],
    };
  }
  if (name === 'pre') {
    // marked emits <pre><code class="language-xx">…</code></pre>
    let codeText = '';
    let lang: string | undefined;
    for (const t of inner) {
      if (t.kind === 'text') codeText += t.text;
      else if (t.kind === 'open' && t.name === 'code') {
        const cls = t.attrs['class'] ?? '';
        const m = cls.match(/language-([\w+-]+)/);
        if (m) lang = m[1];
      }
    }
    const text = decodeEntities(codeText.replace(/\n$/, ''));
    const node: JSONContent = {
      type: 'codeBlock',
      content: [{ type: 'text', text }],
    };
    if (lang) node.attrs = { language: lang };
    return node;
  }
  // Unknown block — recurse and flatten, so we don't lose the content.
  const innerBlocks = parseBlocks(inner, 0);
  return innerBlocks.length === 1 ? innerBlocks[0] : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a Markdown string into a TipTap document and a parallel plain-text
 * representation. The plain text is what gets indexed in FTS and fed to
 * the summarization prompt.
 *
 * Falls back to an empty document on catastrophic parse failure rather than
 * throwing — import should be lenient.
 */
export function markdownToTiptap(md: string): MarkdownToTiptapResult {
  if (typeof md !== 'string' || md.length === 0) {
    return { contentJson: emptyDoc(), contentText: '' };
  }

  // Configure marked for predictable HTML output. We always want sync parse
  // so we can keep the import route as a regular async function.
  marked.use({
    gfm: true,
    breaks: false,
    async: false,
  });

  let html: string;
  try {
    html = marked.parse(md) as string;
  } catch (err) {
    console.error('[markdown] marked.parse failed:', err);
    return { contentJson: emptyDoc(), contentText: md.trim() };
  }

  if (typeof html !== 'string' || html.length === 0) {
    return { contentJson: emptyDoc(), contentText: md.trim() };
  }

  const tokens = tokenizeHtml(html);
  const blocks = parseBlocks(tokens, 0);
  const contentJson: JSONContent = {
    type: 'doc',
    content: blocks.length > 0 ? blocks : [emptyParagraph()],
  };
  const contentText = extractText(contentJson);
  return { contentJson, contentText };
}

function emptyDoc(): JSONContent {
  return { type: 'doc', content: [emptyParagraph()] };
}

// ---------------------------------------------------------------------------
// TipTap → Markdown
// ---------------------------------------------------------------------------

/**
 * Render a TipTap document as a Markdown string. We only cover the subset of
 * nodes that we actually persist, so this isn't a general-purpose converter.
 * Anything we don't recognise is rendered as plain text inside a paragraph
 * so the output is still readable.
 */
export function tiptapToMarkdown(doc: JSONContent | null | undefined): string {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return '';
  return doc.content.map((node) => nodeToMarkdown(node, 0)).join('\n\n').trimEnd() + '\n';
}

function nodeToMarkdown(node: JSONContent, depth: number): string {
  if (!node || typeof node !== 'object') return '';
  const children = Array.isArray(node.content) ? node.content : [];

  switch (node.type) {
    case 'heading': {
      const level = clampHeadingLevel(node.attrs?.['level']);
      if (level === 0) return inlineChildrenToMarkdown(children);
      const prefix = '#'.repeat(level);
      return `${prefix} ${inlineChildrenToMarkdown(children)}`;
    }
    case 'paragraph':
      return inlineChildrenToMarkdown(children);
    case 'blockquote':
      return children.map((c) => `> ${nodeToMarkdown(c, depth + 1)}`).join('\n');
    case 'codeBlock': {
      const lang = typeof node.attrs?.['language'] === 'string' ? node.attrs['language'] : '';
      const text = children.map((c) => c.text ?? '').join('');
      return '```' + lang + '\n' + text + '\n```';
    }
    case 'bulletList':
      return children
        .map((c) => listItemToMarkdown(c, '-', depth))
        .filter((s) => s.length > 0)
        .join('\n');
    case 'orderedList':
      return children
        .map((c, i) => listItemToMarkdown(c, `${i + 1}.`, depth))
        .filter((s) => s.length > 0)
        .join('\n');
    case 'horizontalRule':
      return '---';
    case 'hardBreak':
      return '  \n';
    default:
      return inlineChildrenToMarkdown(children);
  }
}

function clampHeadingLevel(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 1) return 0;
  if (n > 6) return 6;
  return Math.floor(n);
}

function listItemToMarkdown(node: JSONContent, marker: string, depth: number): string {
  if (node.type !== 'listItem' || !Array.isArray(node.content)) return '';
  const indent = '  '.repeat(depth);
  const inner = node.content.map((c) => nodeToMarkdown(c, depth + 1)).join('\n\n');
  if (!inner) return `${indent}${marker}`;
  // First line gets the marker; subsequent lines get indentation.
  const lines = inner.split('\n');
  const first = lines.shift() ?? '';
  return `${indent}${marker} ${first}${lines.length ? '\n' + lines.map((l) => `${indent}  ${l}`).join('\n') : ''}`;
}

function inlineChildrenToMarkdown(children: JSONContent[]): string {
  return children.map(inlineToMarkdown).join('');
}

function inlineToMarkdown(node: JSONContent): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') {
    return applyMarks(node.text ?? '', Array.isArray(node.marks) ? node.marks : []);
  }
  if (node.type === 'hardBreak') return '  \n';
  if (node.type === 'image') {
    const src = String(node.attrs?.['src'] ?? '');
    const alt = String(node.attrs?.['alt'] ?? '');
    return `![${alt}](${src})`;
  }
  // Unknown inline — recurse into children if any.
  if (Array.isArray(node.content)) {
    return node.content.map(inlineToMarkdown).join('');
  }
  return '';
}

function applyMarks(text: string, marks: JSONContent[]): string {
  let out = escapeMd(text);
  for (const mark of marks) {
    if (!mark || typeof mark !== 'object') continue;
    switch (mark.type) {
      case 'bold':
        out = `**${out}**`;
        break;
      case 'italic':
        out = `*${out}*`;
        break;
      case 'code':
        out = `\`${text.replace(/`/g, '\\`')}\``; // raw, no escaping inside code
        break;
      case 'strike':
        out = `~~${out}~~`;
        break;
      case 'link': {
        const href = String(mark.attrs?.['href'] ?? '');
        out = `[${out}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function escapeMd(text: string): string {
  // Escape characters that would otherwise start markdown syntax. Backslash
  // itself must be escaped first to avoid double-escaping.
  return text.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}
