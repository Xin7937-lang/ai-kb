'use client';

// Searchable tag-filter dropdown for the left sidebar. Replaces the
// old `tag-filter.tsx` (a checkbox list that lived next to the note
// list on the home page). The sidebar host is more discoverable for
// a cross-cutting filter and the dropdown + search scales to a large
// tag list without dominating the screen.
//
// Behavior:
//   - Trigger button shows "筛选标签" (or "#active" when filtered).
//   - Click opens a panel with a search input and a scrollable list.
//   - Typing in the search filters by substring (case-insensitive).
//   - Click a tag -> sets ?tag=<id> in the URL, closes the panel.
//   - Click "全部标签" -> clears the filter.
//   - Click outside the panel closes it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Tag } from '@/lib/notes/queries';
import { UNTAGGED_FILTER_ID } from '@/lib/notes/constants';

export function SidebarTagFilter({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeIdRaw = searchParams.get('tag');
  const activeId =
    activeIdRaw && /^-?\d+$/.test(activeIdRaw) ? Number(activeIdRaw) : null;
  const isUntagged = activeId === UNTAGGED_FILTER_ID;
  const activeTag = !isUntagged && activeId !== null ? tags.find((t) => t.id === activeId) : null;

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click + Escape key.
  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  // Auto-focus the search input when the panel opens.
  useEffect(() => {
    if (isOpen) {
      // Defer one tick so the input is mounted.
      const t = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [isOpen]);

  const filteredTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, search]);

  function apply(nextId: number | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextId !== null) {
      params.set('tag', String(nextId));
    } else {
      params.delete('tag');
    }
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : '/');
    setIsOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="w-full justify-between gap-1.5 px-2"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-sm">
            {isUntagged ? '无标签' : activeTag ? `#${activeTag.name}` : '筛选标签'}
          </span>
        </span>
        {activeTag ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="清除筛选"
            onClick={(e) => {
              e.stopPropagation();
              apply(null);
            }}
            className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-3 w-3" />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{tags.length}</span>
        )}
      </Button>

      {isOpen ? (
        <div
          role="listbox"
          aria-label="按标签筛选"
          className={cn(
            'absolute left-0 right-0 top-full z-50 mt-1',
            'rounded-md border bg-popover p-2 text-popover-foreground shadow-md',
          )}
        >
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标签…"
            aria-label="搜索标签"
            className="mb-2 h-8 text-sm"
          />
          <ul className="max-h-60 space-y-0.5 overflow-y-auto">
            <li>
              <button
                type="button"
                onClick={() => apply(null)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                  'transition-colors hover:bg-accent hover:text-accent-foreground',
                  activeId === null && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="flex-1">全部标签</span>
                {activeId === null ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : null}
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => apply(UNTAGGED_FILTER_ID)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                  'transition-colors hover:bg-accent hover:text-accent-foreground',
                  isUntagged && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="flex-1 text-muted-foreground">无标签笔记</span>
                {isUntagged ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : null}
              </button>
            </li>
            {filteredTags.length === 0 ? (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                没有匹配的标签
              </li>
            ) : (
              filteredTags.map((tag) => {
                const isActive = activeId === tag.id;
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() => apply(tag.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                        'transition-colors hover:bg-accent hover:text-accent-foreground',
                        isActive && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span className="flex-1 truncate">#{tag.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {tag.count}
                      </span>
                      {isActive ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
