'use client';

// Client wrapper around the note list that manages batch-selection state.
// Checkboxes are hidden by default. Click "选择笔记" to enter selection
// mode, then checkboxes appear on each row and a floating action bar
// with "批量标签" becomes available.

import { useMemo, useState } from 'react';
import { CheckSquare, X } from 'lucide-react';
import type { NoteSummary } from '@/lib/notes/queries';
import { NoteListRow } from './note-list-row';
import { BatchTagDialog } from './batch-tag-dialog';

export function NoteListWithSelection({
  notes,
  selectedId,
  tagId,
  suggestedTags,
  searchHeader,
  pagination,
}: {
  notes: NoteSummary[];
  selectedId: string | undefined;
  tagId: number | undefined;
  suggestedTags: string[];
  /** Optional search-results header rendered above the list. */
  searchHeader?: React.ReactNode;
  /** Optional pagination controls rendered after the list. */
  pagination?: React.ReactNode;
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  function enterSelectionMode() {
    setSelectionMode(true);
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelected() {
    setSelectedIds(new Set());
  }

  // Compute common tags across ALL selected notes (intersection).
  const commonTags = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const selected = notes.filter((n) => selectedIds.has(n.id));
    if (selected.length === 0) return [];
    const tagSets = selected.map((n) => new Set(n.tags));
    return [...tagSets.reduce((acc, s) => {
      for (const t of acc) if (!s.has(t)) acc.delete(t);
      return acc;
    }, new Set(tagSets[0]))];
  }, [notes, selectedIds]);

  const selCount = selectedIds.size;

  return (
    <>
      {/* Search results header */}
      {searchHeader ? (
        <div className="shrink-0">{searchHeader}</div>
      ) : null}

      {/* Note list + pagination */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {selectionMode
              ? '没有匹配的笔记 — 试试调整搜索或筛选条件。'
              : '还没有笔记 — 点左上角菜单中的「新建」开始'}
          </div>
        ) : (
          <>
            {selectionMode ? (
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
                <span className="text-xs text-muted-foreground">
                  {selectedIds.size > 0
                    ? `已选 ${selectedIds.size} 篇`
                    : '点击左侧勾选笔记'}
                </span>
                <div className="flex items-center gap-1">
                  {selectedIds.size > 0 ? (
                    <button
                      type="button"
                      onClick={() => setDialogOpen(true)}
                      className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      批量标签
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={clearSelected}
                    className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    清除
                  </button>
                  <button
                    type="button"
                    onClick={exitSelectionMode}
                    className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="mr-0.5 inline h-3 w-3" />
                    退出选择
                  </button>
                </div>
              </div>
            ) : notes.length > 0 ? (
              <button
                type="button"
                onClick={enterSelectionMode}
                className="flex w-full items-center gap-1.5 border-b px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                选择笔记
              </button>
            ) : null}
            <ul className="divide-y">
              {notes.map((note) => (
                <NoteListRow
                  key={note.id}
                  note={note}
                  selected={note.id === selectedId}
                  selectable={selectionMode}
                  isChecked={selectedIds.has(note.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </ul>
            {pagination ? (
              <div className="border-t px-3 py-2">{pagination}</div>
            ) : null}
          </>
        )}
      </div>

      {/* Batch action bar (sticky bottom when items selected) */}
      {selectionMode && selCount > 0 ? (
        <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t bg-card px-3 py-2 shadow-md">
          <span className="text-sm">
            已选 <strong>{selCount}</strong> 篇
          </span>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            批量标签
          </button>
          <button
            type="button"
            onClick={clearSelected}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            清除选择
          </button>
          <button
            type="button"
            onClick={exitSelectionMode}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            退出选择
          </button>
        </div>
      ) : null}

      {/* Batch tag dialog */}
      <BatchTagDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        noteIds={Array.from(selectedIds)}
        commonTags={commonTags}
        allTags={suggestedTags}
      />
    </>
  );
}
