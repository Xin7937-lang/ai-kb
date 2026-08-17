'use client';

// Rich-text editor backed by TipTap. MVP scope: StarterKit + Placeholder +
// Image + Table, with a minimal inline toolbar (bold/italic/strike/H1/H2/
// quote/lists/code/code-block/image/table). Image upload is wired in S5.

import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import { StarterKit } from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Code as CodeIcon,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Strikethrough,
  Table as TableIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractText } from '@/lib/notes/text-extract';
import { EMPTY_TIPTAP_DOC } from '@/lib/notes/tiptap-init';
import { selectClipboardImage } from '@/lib/storage/clipboard-image';

export type TiptapEditorProps = {
  value: JSONContent | null;
  onChange: (json: JSONContent, text: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
};

export function TiptapEditor({
  value,
  onChange,
  placeholder = '开始写作…',
  editable = true,
  className,
}: TiptapEditorProps) {
  const [isUploading, setIsUploading] = useState(false);
  const isUploadingRef = useRef(false);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  // We have to pass `null!` here because @types/react's `useRef` only infers
  // a JSX-compatible RefObject (not a RefObject<HTMLInputElement | null>) when
  // the type parameter is the non-null T. The current value can still be null
  // at runtime; the bang just satisfies the type checker.
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Note: v2.6.6 StarterKit does NOT bundle Table, so we just add
        // the table extensions below without needing to disable anything.
      }),
      Placeholder.configure({ placeholder }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: 'rounded-md max-w-full h-auto my-2' },
      }),
      // Link is not in StarterKit; added explicitly so the editor can
      // parse documents persisted with link marks (e.g. anything
      // imported from Markdown) instead of failing the schema check.
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
    editable,
    editorProps: {
      attributes: {
        class: 'ProseMirror prose-sm sm:prose-base max-w-none focus:outline-none',
      },
      handlePaste(view, event) {
        const image = selectClipboardImage<File>(
          event.clipboardData ? Array.from(event.clipboardData.items) : [],
        );
        if (!image) return false;

        event.preventDefault();
        if (isUploadingRef.current) return true;

        const currentEditor = editorRef.current;
        if (!currentEditor) return true;

        const selectionFrom = view.state.selection.from;
        const selectionTo = view.state.selection.to;
        const mapping = view.state.tr.mapping;
        const onTransaction = ({ transaction }: { transaction: Transaction }) => {
          if (transaction.docChanged) {
            mapping.appendMapping(transaction.mapping);
          }
        };
        currentEditor.on('transaction', onTransaction);

        void uploadImage(image, (url) => {
          currentEditor.off('transaction', onTransaction);
          if (currentEditor.isDestroyed) return;

          try {
            const from = mapping.map(selectionFrom, -1);
            const to = mapping.map(selectionTo, -1);
            const inserted = currentEditor
              .chain()
              .setTextSelection({ from, to })
              .focus()
              .setImage({ src: url })
              .run();
            if (!inserted) {
              throw new Error('editor rejected the image insertion');
            }
          } catch (err) {
            console.error('[tiptap-editor] clipboard image insert failed:', err);
            alert('Image upload succeeded but could not be inserted');
          }
        }).finally(() => {
          currentEditor.off('transaction', onTransaction);
        });

        return true;
      },
    },
    onUpdate({ editor: e }) {
      onChange(e.getJSON(), extractText(e.getJSON()));
    },
  });
  editorRef.current = editor;

  // When the value prop changes from outside (e.g. after a refetch), update
  // the editor only if the JSON actually differs -- otherwise we'd reset the
  // caret position on every keystroke.
  useEffect(() => {
    if (!editor) return;
    const incoming = value ?? EMPTY_TIPTAP_DOC;
    const current = editor.getJSON();
    if (JSON.stringify(incoming) === JSON.stringify(current)) return;
    editor.commands.setContent(incoming, false);
  }, [editor, value]);

  // Keep editable prop in sync (e.g. when toggling view/edit mode).
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  async function uploadImage(
    file: File,
    onUploaded: (url: string) => void,
  ): Promise<void> {
    if (isUploadingRef.current) return;
    isUploadingRef.current = true;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/uploads', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        const msg = errBody?.message || errBody?.error || `Upload failed (${res.status})`;
        alert(`Image upload failed: ${msg}`);
        return;
      }
      const json = (await res.json()) as { data?: { url?: string } };
      const url = json.data?.url;
      if (!url) {
        alert('Image upload failed: server did not return a URL');
        return;
      }

      try {
        onUploaded(url);
      } catch (err) {
        console.error('[tiptap-editor] image insert failed:', err);
        alert('Image upload succeeded but could not be inserted');
      }
    } catch (err) {
      console.error('[tiptap-editor] upload failed:', err);
      const message = err instanceof Error ? err.message : 'unknown error';
      alert(`Image upload failed: ${message}`);
    } finally {
      isUploadingRef.current = false;
      setIsUploading(false);
      // Reset the input so picking the same file again still fires `change`.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleFileSelected(file: File) {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    await uploadImage(file, (url) => {
      if (currentEditor.isDestroyed) return;
      currentEditor.chain().focus().setImage({ src: url }).run();
    });
  }

  function openFilePicker() {
    if (isUploadingRef.current) return;
    fileInputRef.current?.click();
  }

  function insertTable() {
    if (!editor) return;
    // Default: 3x3 with the first row as a header. User can grow/shrink
    // from there using the row/column context menu (added in a future pass).
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  }

  if (!editor) {
    return (
      <div
        className={cn(
          'rounded-md border bg-card text-muted-foreground min-h-[400px] p-4',
          className,
        )}
      >
        Loading editor...
      </div>
    );
  }

  return (
    <div className={cn('rounded-md border bg-card', className)}>
      {editable ? (
        <Toolbar
          editor={editor}
          isUploading={isUploading}
          onPickImage={openFilePicker}
          fileInputRef={fileInputRef}
          onFileSelected={handleFileSelected}
          onInsertTable={insertTable}
        />
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

type ToolButtonProps = {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
};

function ToolButton({ active, disabled, onClick, label, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault() /* keep focus in editor */}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({
  editor,
  isUploading,
  onPickImage,
  fileInputRef,
  onFileSelected,
  onInsertTable,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  isUploading: boolean;
  onPickImage: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileSelected: (file: File) => void;
  onInsertTable: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b bg-card px-2 py-1">
      <ToolButton
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolButton
        label="Heading 1"
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="Heading 2"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="Blockquote"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-4 w-4" />
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolButton
        label="Bullet list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="Ordered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolButton
        label="Inline code"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <CodeIcon className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="Code block"
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <span className="font-mono text-[10px] font-semibold">{'</>'}</span>
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolButton
        label="Insert table"
        onClick={onInsertTable}
      >
        <TableIcon className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label={isUploading ? 'Uploading...' : 'Insert image'}
        disabled={isUploading}
        onClick={onPickImage}
      >
        {isUploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ImageIcon className="h-4 w-4" />
        )}
      </ToolButton>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
        }}
      />

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolButton
        label="跳到笔记开头"
        onClick={() => {
          const el = editor.view.dom;
          let parent = el.parentElement;
          while (parent) {
            const style = window.getComputedStyle(parent);
            if (/(auto|scroll)/.test(style.overflow + style.overflowY)) {
              parent.scrollTo({ top: 0, behavior: 'smooth' });
              break;
            }
            parent = parent.parentElement;
          }
        }}
      >
        <ArrowUpToLine className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="跳到笔记末尾"
        onClick={() => {
          const el = editor.view.dom;
          let parent = el.parentElement;
          while (parent) {
            const style = window.getComputedStyle(parent);
            if (/(auto|scroll)/.test(style.overflow + style.overflowY)) {
              parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
              break;
            }
            parent = parent.parentElement;
          }
        }}
      >
        <ArrowDownToLine className="h-4 w-4" />
      </ToolButton>
    </div>
  );
}
