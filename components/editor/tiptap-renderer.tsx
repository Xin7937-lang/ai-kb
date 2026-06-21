'use client';

// Read-only TipTap view, used by the note detail page. The same StarterKit
// extensions are loaded so headings/lists/code blocks render with the styles
// defined in `app/globals.css`. Image and Table are also loaded here so
// that existing notes containing <img> or <table> nodes (added in S5 /
// added in this iteration) render correctly in the read-only view.

import { useEffect } from 'react';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { cn } from '@/lib/utils';
import { EMPTY_TIPTAP_DOC } from '@/lib/notes/tiptap-init';

export type TiptapRendererProps = {
  value: JSONContent | null;
  className?: string;
};

export function TiptapRenderer({ value, className }: TiptapRendererProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Note: v2.6.6 StarterKit does NOT bundle Table, so we just add
        // the table extensions below without needing to disable anything.
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: 'rounded-md max-w-full h-auto my-2' },
      }),
      // Link is not in StarterKit. Without it, any document containing
      // a `link` mark (e.g. anything imported from Markdown that had a
      // [text](url) form) fails to parse and the editor renders an
      // empty doc -- which was the "blank body on imported note" bug.
      // `openOnClick: false` because this is a read-only view; we don't
      // want the cursor to land in a link-editor bubble on click.
      Link.configure({ openOnClick: false }),
      Table.configure({
        resizable: false,
        HTMLAttributes: { class: 'kb-table' },
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value ?? EMPTY_TIPTAP_DOC,
    editable: false,
    editorProps: {
      attributes: {
        class: 'ProseMirror prose-sm sm:prose-base max-w-none focus:outline-none',
      },
    },
  });

  // TipTap's `content` option is only consumed at editor creation, so soft
  // client-side navigation between notes in the master list (which keeps
  // this component mounted) would leave the editor showing the previous
  // note's body. Sync `value` -> editor when it changes. The `JSON.stringify`
  // guard mirrors tiptap-editor.tsx and avoids a no-op re-render when a
  // parent re-renders with an equivalent doc.
  useEffect(() => {
    if (!editor) return;
    const incoming = value ?? EMPTY_TIPTAP_DOC;
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(incoming)) return;
    editor.commands.setContent(incoming, false);
  }, [editor, value]);

  if (!editor) {
    return (
      <div className={cn('rounded-md border bg-card min-h-[120px] p-4', className)} />
    );
  }

  return (
    <div className={cn('rounded-md border bg-card p-4', className)}>
      <EditorContent editor={editor} />
    </div>
  );
}
