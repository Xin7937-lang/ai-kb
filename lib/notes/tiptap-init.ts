// Default empty TipTap document. Used to seed a brand-new note and as a
// safe fallback when the stored JSON is null/empty/malformed.
//
// TipTap's StarterKit requires a `doc` root whose `content` is an array of
// block nodes; a single empty paragraph is the smallest valid document.

import type { JSONContent } from '@tiptap/react';

export const EMPTY_TIPTAP_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};
