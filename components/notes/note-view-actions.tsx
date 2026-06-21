'use client';

// View-mode chrome for a single note. The page is a server component that
// loads the note; this client island renders the "Favorite", "Edit" and
// "Delete" buttons.

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FAVORITES_TAG_NAME } from '@/lib/notes/constants';
import type { NoteFull } from '@/lib/notes/queries';

export function NoteViewActions({ note }: { note: NoteFull }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Local mirror of the favorited state. We start from the server-known
  // tag list, then flip on every click. `router.refresh()` after a
  // successful toggle reconciles with the server.
  const [favorited, setFavorited] = useState<boolean>(
    note.tags.includes(FAVORITES_TAG_NAME),
  );

  function onToggleFavorite() {
    setError(null);
    // Optimistic flip so the star fills/empties instantly.
    setFavorited((v) => !v);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/favorite`, {
          method: 'POST',
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          setError(data.message ?? data.error ?? '收藏操作失败');
          // Revert optimistic flip.
          setFavorited((v) => !v);
          return;
        }
        const json = (await res.json()) as {
          data: { favorited: boolean };
        };
        // Server is authoritative.
        setFavorited(json.data.favorited);
        router.refresh();
      } catch (err) {
        console.error('[note-view] favorite failed:', err);
        setError('网络错误，请重试');
        setFavorited((v) => !v);
      }
    });
  }

  function onDelete() {
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
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setError(data.message ?? data.error ?? '删除失败');
      } catch (err) {
        console.error('[note-view] delete failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={favorited ? 'default' : 'outline'}
        size="sm"
        onClick={onToggleFavorite}
        disabled={isPending}
        aria-pressed={favorited}
        title={favorited ? '取消收藏' : '加入收藏'}
      >
        <Star
          className={cn(
            'mr-1 h-4 w-4',
            favorited && 'fill-primary-foreground',
          )}
        />
        {favorited ? '已收藏' : '收藏'}
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href={`/notes/${note.id}?edit=1`}>
          <Pencil className="mr-1 h-4 w-4" />
          编辑
        </Link>
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={onDelete}
        disabled={isPending}
      >
        <Trash2 className="mr-1 h-4 w-4" />
        {isPending ? '删除中…' : '删除'}
      </Button>
      {error ? (
        <span className="text-sm text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
