'use client';

// Inline tag editor for the note detail view. Default state is a
// single row: chips with hover-X to remove + a small "+ 添加标签"
// trigger. Clicking the trigger expands an inline form (dropdown of
// existing tags + new-tag textbox + add button + 完成 to close).
// This is much more compact than the always-shown form, leaving
// more vertical space for the note content.
//
// Every add/remove auto-saves via PUT /api/notes/:id/tags; the
// `savedAt` pill briefly shows "已保存" after each save. A deep-equal
// useEffect also pulls in `initialTags` changes from the server
// (e.g. after AI auto-tag from the summarize flow) so the chips
// stay in sync without losing any in-progress draft input.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type NoteTagsEditorProps = {
  noteId: string;
  initialTags: string[];
  /** All existing tag names in the DB, for the "从已有标签选择" dropdown. */
  suggestions: string[];
};

type ApiError = { error?: string; message?: string };

export function NoteTagsEditor({
  noteId,
  initialTags,
  suggestions,
}: NoteTagsEditorProps) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [isExpanded, setIsExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [dropdownValue, setDropdownValue] = useState('');
  const [isSaving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync local tags with the prop. This is the fix for the
  // "auto-tag doesn't appear in chips" bug: when the user clicks
  // 生成摘要, the server persists 1-3 new tags, then
  // `router.refresh()` re-runs the home page server-side with the
  // updated `note.tags` -> this component's `initialTags` prop
  // changes. Without this useEffect, the local `tags` state would
  // stay at its initial value and the chips would show the old set.
  //
  // The deep-equal check keeps this a no-op when nothing changed
  // (e.g. the user typed in the draft but hasn't added yet), so
  // the draft input is never clobbered.
  useEffect(() => {
    const same =
      initialTags.length === tags.length &&
      initialTags.every((t, i) => t === tags[i]);
    if (!same) {
      setTags(initialTags);
    }
    // We intentionally do NOT depend on `tags` -- that would make
    // this effect run after every local state change and ping-pong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTags]);

  // Auto-clear the "已保存" pill after 1.5s.
  useEffect(() => {
    if (savedAt === null) return;
    const t = window.setTimeout(() => setSavedAt(null), 1500);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  // Click outside the widget to collapse the expanded form. Disabled
  // while a save is in flight to avoid mid-flight state thrash.
  useEffect(() => {
    if (!isExpanded) return;
    function onPointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsExpanded(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isExpanded]);

  const available = useMemo(
    () => suggestions.filter((t) => !tags.includes(t)),
    [suggestions, tags],
  );

  const save = useCallback(
    (nextTags: string[]) => {
      setError(null);
      startSave(async () => {
        try {
          const res = await fetch(`/api/notes/${noteId}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: nextTags }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as ApiError;
            setError(data.message ?? data.error ?? '保存失败');
            return;
          }
          setSavedAt(Date.now());
          router.refresh();
        } catch (err) {
          console.error('[note-tags-editor] save failed:', err);
          setError('网络错误，请重试');
        }
      });
    },
    [noteId, router],
  );

  function addTag(raw: string) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return;
    if (tags.includes(normalized)) {
      setDraft('');
      return;
    }
    const next = [...tags, normalized];
    setTags(next);
    setDraft('');
    setDropdownValue('');
    save(next);
  }

  function removeTag(t: string) {
    if (isSaving) return;
    const next = tags.filter((x) => x !== t);
    setTags(next);
    save(next);
  }

  function collapse() {
    setIsExpanded(false);
    setDraft('');
    setDropdownValue('');
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">没有标签</span>
        ) : (
          tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                'group inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground',
                'transition-colors',
              )}
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={isSaving}
                aria-label={`删除标签 ${tag}`}
                title="删除"
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground',
                  'opacity-0 transition-opacity group-hover:opacity-100',
                  'hover:bg-destructive hover:text-destructive-foreground',
                  'focus-visible:opacity-100',
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}

        {!isExpanded ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(true)}
            disabled={isSaving}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            aria-label="添加标签"
          >
            <Plus className="mr-0.5 h-3 w-3" />
            添加标签
          </Button>
        ) : null}

        {isSaving ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            保存中…
          </span>
        ) : savedAt !== null ? (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            已保存
          </span>
        ) : null}
      </div>

      {isExpanded ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card/40 p-2">
          <select
            value={dropdownValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                addTag(v);
                setDropdownValue('');
              }
            }}
            disabled={isSaving || available.length === 0}
            aria-label="从已有标签选择"
            className={cn(
              'h-7 max-w-[14rem] rounded-md border border-input bg-background px-2 text-xs',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <option value="">
              {available.length === 0 ? '没有可添加的标签' : '从已有标签选择…'}
            </option>
            {available.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>

          <div className="flex min-w-[10rem] flex-1 items-center gap-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(draft);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  collapse();
                }
              }}
              placeholder="添加新标签"
              disabled={isSaving}
              aria-label="添加新标签"
              className="h-7 flex-1 text-xs"
              autoFocus
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => addTag(draft)}
              disabled={isSaving || !draft.trim()}
              aria-label="添加"
              className="h-7 w-7"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={collapse}
            disabled={isSaving}
            className="h-7 text-xs"
          >
            完成
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
