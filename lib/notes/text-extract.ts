// TipTap JSON document → plain text.
//
// We walk the document tree depth-first, collecting text from `text` nodes and
// inserting a blank line between block-level nodes. The result is what we
// store in `notes.content_text` and feed into FTS / summarization.
//
// Robustness: an unknown / malformed node shape is silently skipped; we never
// throw. The caller can therefore use this on user input without wrapping.

import type { JSONContent } from '@tiptap/react';

const BLOCK_NODE_TYPES = new Set<string>([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'listItem',
  'horizontalRule',
]);

interface TextContainer {
  type?: string;
  text?: string;
  content?: unknown[];
}

function isTextContainer(node: unknown): node is TextContainer {
  return typeof node === 'object' && node !== null;
}

function extractFromNode(node: unknown, parts: string[]): void {
  if (!isTextContainer(node)) return;

  if (typeof node.text === 'string') {
    parts.push(node.text);
    return;
  }

  const childContent = node.content;
  if (!Array.isArray(childContent)) return;

  for (const child of childContent) {
    extractFromNode(child, parts);
  }

  if (typeof node.type === 'string' && BLOCK_NODE_TYPES.has(node.type)) {
    parts.push('\n\n');
  }
}

/**
 * Convert a TipTap JSON document into a plain-text representation suitable for
 * FTS indexing and summarization input.
 */
export function extractText(doc: JSONContent | null | undefined): string {
  if (!doc || doc.type !== 'doc') return '';
  const parts: string[] = [];
  extractFromNode(doc, parts);
  // Collapse runs of 3+ newlines (caused by adjacent blocks) into a single
  // blank line, then trim leading/trailing whitespace.
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}
