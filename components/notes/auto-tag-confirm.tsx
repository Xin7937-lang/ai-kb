'use client';

// AI-suggested tag confirmation panel. Shown after the summary stream
// completes when the server has auto-suggested 1-3 tags. The user can:
//   - remove individual suggested tags
//   - add new tags
//   - save the resulting set (PUT /api/notes/:id/tags)
//   - dismiss without saving (the auto-persisted tags stay as-is)
//
// The server's `suggestTagsIfMissing` already persisted the suggestions
// when the stream finished; this UI is purely an edit affordance -- the
// user can choose to keep the suggestion, trim it, or extend it.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type AutoTagConfirmProps = {
  noteId: string;
  autoTags: string[];
  onDismiss: () => void;
};

type ApiError = { error?: string; message?: string };

export function AutoTagConfirm({
  noteId,
  autoTags,
  onDismiss,
}: AutoTagConfirmProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string[]>([...autoTags]);
  const [draft, setDraft] = useState('');
  const [isSaving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function addDraft() {
    const normalized = draft.trim().toLowerCase();
    if (!normalized) return;
    if (pending.includes(normalized)) {
      setDraft('');
      return;
    }
    setPending([...pending, normalized]);
    setDraft('');
  }

  function removeTag(t: string) {
    setPending(pending.filter((x) => x !== t));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addDraft();
    }
  }

  function save() {
    // The natural user flow is "type a tag, then click 保存". The previous
    // implementation only sent `pending`, so any tag the user typed but
    // hadn't yet added via the + button / Enter was silently dropped
    // (PUT body became `{ tags: [] }` and the tag never persisted). Fold
    // the uncommitted `draft` into the saved set so the typed tag is
    // never lost. `Set` dedupes against the chips the user already added.
    const normalizedDraft = draft.trim().toLowerCase();
    const finalTags = normalizedDraft
      ? Array.from(new Set([...pending, normalizedDraft]))
      : pending;

    setError(null);
    startSave(async () => {
      try {
        const res = await fetch(`/api/notes/${noteId}/tags`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: finalTags }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as ApiError;
          setError(data.message ?? data.error ?? '保存标签失败');
          return;
        }
        router.refresh();
        onDismiss();
      } catch (err) {
        console.error('[auto-tag-confirm] save failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  return (
    <div className="rounded-md border bg-card p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-medium">AI 建议标签</span>
        <span className="text-xs text-muted-foreground">
          （已自动添加，可调整）
        </span>
      </div>

      {pending.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {pending.map((tag) => (
            <span
              key={tag}
              className={cn(
                'group inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-1 text-xs text-secondary-foreground',
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
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          AI 没有为这篇笔记建议标签。可以直接输入新标签后保存。
        </p>
      )}

      <div className="mt-2 flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="添加新标签"
          disabled={isSaving}
          aria-label="添加新标签"
          className="flex-1"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={addDraft}
          disabled={isSaving || !draft.trim()}
          aria-label="添加标签"
          title="添加"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={isSaving}>
          {isSaving ? '保存中…' : '保存'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          disabled={isSaving}
        >
          关闭
        </Button>
      </div>
    </div>
  );
}
