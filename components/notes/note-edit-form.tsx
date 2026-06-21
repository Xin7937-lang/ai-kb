'use client';

// Edit form for a note, used in both create and edit modes. The `note` prop
// distinguishes them: when null, the form POSTs to /api/notes; when set, it
// PUTs to /api/notes/<id> and shows delete/save buttons.

import { useRouter } from 'next/navigation';
import { useState, useTransition, useEffect, useRef, type FormEvent } from 'react';
import type { JSONContent } from '@tiptap/react';
import { Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { TagInput } from './tag-input';
import { NoteSearchableContent } from './note-searchable-content';
import type { NoteFull } from '@/lib/notes/queries';
import { EMPTY_TIPTAP_DOC } from '@/lib/notes/tiptap-init';

type Mode =
  | { kind: 'create' }
  | { kind: 'edit'; note: NoteFull };

export type NoteEditFormProps = {
  mode: Mode;
  /**
   * All existing tag names in the database. Used to populate the
   * "从已有标签选择" dropdown inside the tag editor.
   */
  suggestedTags?: string[];
  /** Whether the in-page search bar is visible. */
  searchVisible?: boolean;
  /** Toggle the search bar. */
  onToggleSearch?: () => void;
  /** Initial search query to highlight (e.g. from URL ?q=...). */
  highlightQuery?: string;
};

type ApiError = { error?: string; message?: string };

export function NoteEditForm({ mode, suggestedTags = [], searchVisible = false, onToggleSearch, highlightQuery }: NoteEditFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = mode.kind === 'edit' ? mode.note : null;
  const [title, setTitle] = useState<string>(initial?.title ?? '');
  const [contentJson, setContentJson] = useState<JSONContent>(
    initial?.contentJson ?? EMPTY_TIPTAP_DOC,
  );
  const [contentText, setContentText] = useState<string>(
    initial?.contentText ?? '',
  );
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);

  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const lastSavedRef = useRef({
    title: initial?.title ?? '',
    contentJson: initial?.contentJson ?? EMPTY_TIPTAP_DOC,
    contentText: initial?.contentText ?? '',
    tags: initial?.tags ?? [],
  });

  const editNoteId = mode.kind === 'edit' ? mode.note.id : undefined;

  // Ref to always read latest state inside the interval callback.
  const stateRef = useRef({ title, contentJson, contentText, tags });
  stateRef.current = { title, contentJson, contentText, tags };

  useEffect(() => {
    if (!editNoteId) return;

    const interval = setInterval(async () => {
      const current = stateRef.current;
      const last = lastSavedRef.current;

      const hasChanges =
        current.title !== last.title ||
        current.contentText !== last.contentText ||
        JSON.stringify(current.contentJson) !== JSON.stringify(last.contentJson) ||
        current.tags.length !== last.tags.length ||
        current.tags.some((t, i) => t !== last.tags[i]);

      if (!hasChanges) return;

      setAutoSaveStatus('saving');

      const body = {
        title: current.title.trim() || '未命名笔记',
        contentJson: current.contentJson,
        contentText: current.contentText,
        tags: current.tags,
      };

      try {
        const res = await fetch(`/api/notes/${editNoteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          lastSavedRef.current = { ...current };
          setAutoSaveStatus('saved');
          setTimeout(() => setAutoSaveStatus('idle'), 2000);
        } else {
          setAutoSaveStatus('idle');
        }
      } catch (err) {
        console.error('[note-edit-form] auto-save failed:', err);
        setAutoSaveStatus('idle');
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [editNoteId]);

  function onEditorChange(nextJson: JSONContent, nextText: string) {
    setContentJson(nextJson);
    setContentText(nextText);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const body = {
      title: title.trim() || '未命名笔记',
      contentJson,
      contentText,
      tags,
    };
    const isEdit = mode.kind === 'edit';
    const url = isEdit ? `/api/notes/${mode.note.id}` : '/api/notes';
    const method = isEdit ? 'PUT' : 'POST';

    startTransition(async () => {
      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as ApiError;
          setError(data.message ?? data.error ?? '保存失败');
          return;
        }
        const json = (await res.json()) as { data: NoteFull };
        lastSavedRef.current = { title, contentJson, contentText, tags };
        router.push(`/notes/${json.data.id}`);
        router.refresh();
      } catch (err) {
        console.error('[note-edit-form] save failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  function onDelete() {
    if (mode.kind !== 'edit') return;
    const note = mode.note;
    if (
      !window.confirm(
        `确定要删除笔记「${note.title || '未命名笔记'}」吗？此操作不可撤销。`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
        if (res.status === 204 || res.ok) {
          router.push('/');
          router.refresh();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as ApiError;
        setError(data.message ?? data.error ?? '删除失败');
      } catch (err) {
        console.error('[note-edit-form] delete failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  return (
    <form id="note-edit-form" onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">标题</Label>
        <Input
          id="title"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="给这篇笔记起个标题…"
          maxLength={500}
          autoFocus={mode.kind === 'create'}
          disabled={isPending}
        />
      </div>

      <div className="space-y-2">
        <Label>标签</Label>
        <TagInput
          value={tags}
          onChange={setTags}
          suggestions={suggestedTags}
          disabled={isPending}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label>内容</Label>
          <Button
            type="button"
            variant={searchVisible ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onToggleSearch}
            title="页内搜索 (Ctrl+F)"
            aria-label="页内搜索"
          >
            <Search className="mr-1 h-3 w-3" />
            页内搜索
          </Button>
        </div>
        {searchVisible ? (
          <NoteSearchableContent
            contentText={contentText}
            onClose={() => onToggleSearch?.()}
            initialQuery={highlightQuery}
          >
            <TiptapEditor
              value={contentJson}
              onChange={onEditorChange}
              placeholder="在这里写下你的想法…"
              editable={!isPending}
            />
          </NoteSearchableContent>
        ) : (
          <TiptapEditor
            value={contentJson}
            onChange={onEditorChange}
            placeholder="在这里写下你的想法…"
            editable={!isPending}
          />
        )}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        {mode.kind === 'edit' && autoSaveStatus !== 'idle' ? (
          <span
            className={
              autoSaveStatus === 'saving'
                ? 'text-xs text-muted-foreground'
                : 'text-xs text-emerald-600 dark:text-emerald-400'
            }
          >
            {autoSaveStatus === 'saving' ? '正在自动保存…' : '已自动保存'}
          </span>
        ) : null}
        <Button type="submit" disabled={isPending}>
          {isPending
            ? '保存中…'
            : mode.kind === 'create'
              ? '创建笔记'
              : '保存修改'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          取消
        </Button>
        {mode.kind === 'edit' ? (
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={isPending}
            className="ml-auto"
          >
            <Trash2 className="mr-1 h-4 w-4" />
            删除
          </Button>
        ) : null}
      </div>
    </form>
  );
}
