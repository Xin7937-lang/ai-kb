'use client';

// Search bar for in-page content search. Appears above the TipTap
// content area. Supports keyboard shortcuts:
//   Ctrl+F / Cmd+F  → focus search input
//   Enter           → next match
//   Shift+Enter     → previous match
//   Esc             → close

import { useRef, useEffect, useCallback } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  query: string;
  matchCount: number;
  activeIndex: number;
  onChange: (query: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function NoteSearchBar({
  query,
  matchCount,
  activeIndex,
  onChange,
  onPrev,
  onNext,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ctrl+F / Cmd+F → focus
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      // Esc → close
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      data-search-bar
      className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 shadow-sm"
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
              onPrev();
            } else {
              onNext();
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="搜索内容…"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {query ? (
        <>
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              matchCount > 0 ? 'text-muted-foreground' : 'text-destructive',
            )}
          >
            {matchCount > 0
              ? `${activeIndex + 1}/${matchCount}`
              : '无匹配'}
          </span>
          <button
            type="button"
            onClick={onPrev}
            disabled={matchCount === 0}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
            title="上一个 (Shift+Enter)"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={matchCount === 0}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
            title="下一个 (Enter)"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
        title="关闭 (Esc)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
