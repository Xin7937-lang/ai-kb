'use client';

// Compact row for the left column of the master-detail home page.
// Replaces the old `NoteListItem` (full card) — a card layout wastes
// vertical space when you have a long list to scan.
//
// On mobile (< md), links to /notes/[id] (push navigation to full detail
// page). On desktop, links to /?note=<id> (master-detail URL-param).

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import type { NoteSummary } from '@/lib/notes/queries';

const ONE_MIN_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MIN_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < ONE_MIN_MS) return '刚刚';
  if (diff < ONE_HOUR_MS) return `${Math.floor(diff / ONE_MIN_MS)} 分钟前`;
  if (diff < ONE_DAY_MS) return `${Math.floor(diff / ONE_HOUR_MS)} 小时前`;
  if (diff < 7 * ONE_DAY_MS) return `${Math.floor(diff / ONE_DAY_MS)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function NoteListRow({
  note,
  selected,
  selectable,
  isChecked,
  onToggleSelect,
}: {
  note: NoteSummary;
  selected: boolean;
  selectable?: boolean;
  isChecked?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  params.set('note', note.id);
  const href = isMobile ? `/notes/${note.id}` : `/?${params.toString()}`;

  const visibleTags = note.tags.slice(0, 2);
  const extraTagCount = note.tags.length - visibleTags.length;

  const previewText = note.summary?.trim() || note.preview;
  const hasPreview = previewText.length > 0;

  return (
    <li
      className={cn(
        'group flex items-start gap-1.5',
        selectable && 'pl-2',
      )}
    >
      {selectable && onToggleSelect ? (
        <input
          type="checkbox"
          checked={isChecked ?? false}
          onChange={() => onToggleSelect(note.id)}
          aria-label={`选择「${note.title || '未命名笔记'}」`}
          className="mt-3 h-4 w-4 shrink-0 cursor-pointer"
        />
      ) : null}
      <Link
        href={href}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'block flex-1 px-3 py-2 transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected && 'bg-accent text-accent-foreground',
        )}
      >
        <div className="line-clamp-2 text-sm font-medium leading-snug">
          {note.title || '未命名笔记'}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{formatRelative(note.updatedAt)}</span>
          {visibleTags.length > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">
                {visibleTags.map((t) => `#${t}`).join(' ')}
                {extraTagCount > 0 ? ` +${extraTagCount}` : ''}
              </span>
            </>
          ) : null}
        </div>
        {hasPreview ? (
          <p
            className={cn(
              'mt-1 line-clamp-3 text-xs leading-relaxed',
              note.summary ? 'text-foreground/70' : 'text-muted-foreground',
            )}
          >
            {previewText}
          </p>
        ) : null}
      </Link>
    </li>
  );
}
