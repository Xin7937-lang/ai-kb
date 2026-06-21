'use client';

// Batch tag editor: a modal overlay for adding/removing tags on a set
// of selected notes. Shows common tags across all selected notes for
// easy removal, and a tag picker + new-tag input for additions.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ApiError = { error?: string; message?: string };

export function BatchTagDialog({
  open,
  onClose,
  noteIds,
  commonTags,
  allTags,
}: {
  open: boolean;
  onClose: () => void;
  noteIds: string[];
  /** Tags that ALL selected notes share. Shown in the "remove" section. */
  commonTags: string[];
  /** Every existing tag name in the DB, for the "add" dropdown. */
  allTags: string[];
}) {
  const router = useRouter();
  const [addTags, setAddTags] = useState<string[]>([]);
  const [removeTags, setRemoveTags] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [dropdownValue, setDropdownValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  // Tags available in the add dropdown: everything not already in addTags.
  const availableAdd = allTags.filter((t) => !addTags.includes(t));

  function addFromDropdown(value: string) {
    if (!value) return;
    if (addTags.includes(value)) return;
    setAddTags((prev) => [...prev, value]);
    setDropdownValue('');
  }

  function addFromDraft() {
    const normalized = draft.trim().toLowerCase();
    if (!normalized) return;
    if (addTags.includes(normalized)) return;
    setAddTags((prev) => [...prev, normalized]);
    setDraft('');
  }

  function removeAddTag(t: string) {
    setAddTags((prev) => prev.filter((x) => x !== t));
  }

  function toggleRemoveTag(t: string) {
    setRemoveTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  async function handleApply() {
    if (addTags.length === 0 && removeTags.length === 0) return;
    if (noteIds.length === 0) {
      setError('没有选中任何笔记');
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch('/api/notes/batch-tags', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ noteIds, addTags, removeTags }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as ApiError;
          setError(data.message ?? data.error ?? '操作失败');
          return;
        }
        // Close + refresh — the parent clears selection via onClose.
        onClose();
        router.refresh();
      } catch (err) {
        console.error('[batch-tag] apply failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  const hasChanges = addTags.length > 0 || removeTags.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border bg-card shadow-xl',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">
            批量修改标签 — {noteIds.length} 条笔记
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="关闭"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {/* Add tags section */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">添加标签</h3>

            {/* Chips for tags to add */}
            {addTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {addTags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs"
                  >
                    #{t}
                    <button
                      type="button"
                      onClick={() => removeAddTag(t)}
                      disabled={isPending}
                      aria-label={`移除 ${t}`}
                      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">尚未选择要添加的标签</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={dropdownValue}
                onChange={(e) => addFromDropdown(e.target.value)}
                disabled={isPending || availableAdd.length === 0}
                aria-label="从已有标签选择"
                className={cn(
                  'h-7 max-w-[14rem] rounded-md border border-input bg-background px-2 text-xs',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <option value="">
                  {availableAdd.length === 0 ? '没有可添加的标签' : '从已有标签选择…'}
                </option>
                {availableAdd.map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addFromDraft();
                    }
                  }}
                  placeholder="输入新标签"
                  disabled={isPending}
                  aria-label="输入新标签"
                  className="h-7 w-32 text-xs"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={addFromDraft}
                  disabled={isPending || !draft.trim()}
                  aria-label="添加"
                  className="h-7 w-7"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <hr />

          {/* Remove tags section */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">移除标签</h3>
            {commonTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                选中的笔记没有共同的标签
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {commonTags.map((t) => {
                  const marked = removeTags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleRemoveTag(t)}
                      disabled={isPending}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                        marked
                          ? 'border-destructive bg-destructive/10 text-destructive line-through'
                          : 'hover:border-destructive/50 hover:text-destructive',
                      )}
                    >
                      #{t}
                      <X className="h-2.5 w-2.5" />
                    </button>
                  );
                })}
              </div>
            )}
            {removeTags.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                点击标签切换是否移除。已标记 <strong>{removeTags.length}</strong> 个
              </p>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          {error ? (
            <p className="flex-1 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isPending}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleApply}
            disabled={isPending || !hasChanges}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                应用中…
              </>
            ) : (
              '应用更改'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
