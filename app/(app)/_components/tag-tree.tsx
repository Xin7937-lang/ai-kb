'use client';

// Hierarchical tag tree for the left sidebar. Uses the parent_id-based
// hierarchy from `listTagsWithNotes` / `listTagTree`. Top-level tags
// and their children are rendered with indentation.

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronRight, FileText, Tag as TagIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TagWithNotes } from '@/lib/notes/queries';

export function TagTree({ tagsWithNotes }: { tagsWithNotes: TagWithNotes[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTagId = searchParams.get('tag');

  if (tagsWithNotes.length === 0) {
    return (
      <p className="px-2 text-xs text-muted-foreground">还没有标签</p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {tagsWithNotes.map((tag) => (
        <TagTreeItem
          key={tag.id}
          tag={tag}
          depth={0}
          activeTagId={activeTagId ? Number(activeTagId) : null}
          onHomePage={pathname === '/'}
        />
      ))}
    </ul>
  );
}

function TagTreeItem({
  tag,
  depth,
  activeTagId,
  onHomePage,
}: {
  tag: TagWithNotes;
  depth: number;
  activeTagId: number | null;
  onHomePage: boolean;
}) {
  const hasNotes = tag.notes.length > 0;
  const hasChildren = tag.children.length > 0;
  const initiallyExpanded = tag.id === activeTagId;
  const [expanded, setExpanded] = useState(Boolean(initiallyExpanded));
  const isActive = tag.id === activeTagId;

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md text-sm',
          'transition-all duration-150',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-accent hover:text-accent-foreground',
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {hasNotes || hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={() => setExpanded((v) => !v)}
            className="flex h-6 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-150',
                expanded && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <span className="inline-block h-6 w-5" aria-hidden />
        )}

        <Link
          href={`/?tag=${tag.id}`}
          className={cn(
            'flex flex-1 items-center gap-2 py-1 pr-2',
            onHomePage && isActive && 'font-medium',
          )}
        >
          <TagIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">{tag.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {tag.count}
          </span>
        </Link>
      </div>

      {/* Recent notes under this tag */}
      {expanded && hasNotes ? (
        <ul className="mt-0.5 space-y-0.5">
          {tag.notes.map((note) => (
            <li
              key={note.id}
              style={{ paddingLeft: 4 + (depth + 1) * 14 }}
            >
              <Link
                href={`/notes/${note.id}`}
                className={cn(
                  'flex items-center gap-1.5 rounded-md py-1 pr-2 text-xs text-foreground/70',
                  'hover:bg-accent hover:text-accent-foreground hover:translate-x-0.5',
                )}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate">{note.title || '未命名笔记'}</span>
              </Link>
            </li>
          ))}
          {tag.count > tag.notes.length ? (
            <li style={{ paddingLeft: 4 + (depth + 1) * 14 }}>
              <Link
                href={`/?tag=${tag.id}`}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                查看全部 {tag.count} 篇 →
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* Child tags */}
      {expanded && hasChildren ? (
        <ul className="space-y-0.5">
          {tag.children.map((child) => (
            <TagTreeItem
              key={child.id}
              tag={child}
              depth={depth + 1}
              activeTagId={activeTagId}
              onHomePage={onHomePage}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
