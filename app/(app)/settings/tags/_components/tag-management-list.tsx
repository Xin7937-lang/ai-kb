'use client';

// Tag management: create + hierarchy + drag-to-reorder + batch delete.
// Supports two-level parent-child via parent_id. Built-in tags
// (收藏) can't be deleted.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Star, Trash2, X, ChevronRight } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FAVORITES_TAG_NAME } from '@/lib/notes/constants';
import type { Tag } from '@/lib/notes/queries';

type ApiError = { error?: string; message?: string };

export function TagManagementList({ initialTags }: { initialTags: Tag[] }) {
  const router = useRouter();
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [newTagParentId, setNewTagParentId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Partition into top-level and children
  const topLevel = tags.filter((t) => t.parentId == null);
  const childByParent = new Map<number, Tag[]>();
  for (const t of tags) {
    if (t.parentId != null) {
      const arr = childByParent.get(t.parentId) ?? [];
      arr.push(t);
      childByParent.set(t.parentId, arr);
    }
  }

  const deletableTags = tags.filter((t) => t.name !== FAVORITES_TAG_NAME);
  const someSelected = selected.size > 0;

  function persistOrder(next: Tag[]) {
    startTransition(async () => {
      try {
        const res = await fetch('/api/tags/reorder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: next.map((t) => t.id) }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as ApiError;
          setError(data.message ?? data.error ?? '保存顺序失败');
          setTags(initialTags);
          return;
        }
        router.refresh();
      } catch (err) {
        console.error('[tag-mgmt] reorder failed:', err);
        setError('网络错误，请重试');
        setTags(initialTags);
      }
    });
  }

  function onDragEnd(event: DragEndEvent) {
    setError(null);
    setNotice(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = tags.findIndex((t) => t.id === active.id);
    const newIdx = tags.findIndex((t) => t.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(tags, oldIdx, newIdx);
    setTags(next);
    persistOrder(next);
  }

  function toggleSelect(id: number, name: string) {
    if (name === FAVORITES_TAG_NAME) return;
    setError(null);
    setNotice(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setNotice(null);
  }

  function deleteSelected() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    if (!window.confirm(`确定要删除 ${ids.length} 个标签吗？\n关联的笔记引用会被级联清理，此操作不可撤销。`)) return;

    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/tags/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as ApiError;
          setError(data.message ?? data.error ?? '删除失败');
          return;
        }
        const json = (await res.json().catch(() => ({}))) as {
          data?: { deleted?: number; skipped?: string[] };
        };
        const deleted = json.data?.deleted ?? 0;
        const skipped = json.data?.skipped ?? [];
        setSelected(new Set());
        const bits: string[] = [];
        if (deleted > 0) bits.push(`已删除 ${deleted} 个标签`);
        if (skipped.length > 0) bits.push(`${skipped.length} 个内置标签已跳过`);
        setNotice(bits.length > 0 ? bits.join('；') : '未做任何更改');
        router.refresh();
      } catch (err) {
        console.error('[tag-mgmt] delete failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  function handleCreate(parentId: number | null) {
    const name = parentId == null ? newTagName : newTagName;
    const finalName = name.trim();
    if (!finalName) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: finalName, parentId }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as ApiError;
          setError(data.message ?? data.error ?? '创建失败');
          return;
        }
        if (parentId == null) setNewTagName('');
        setNotice(parentId != null ? `已创建子标签 #${finalName}` : `已创建标签 #${finalName}`);
        router.refresh();
      } catch (err) {
        console.error('[tag-mgmt] create failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Create top-level tag */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleCreate(null); }}
        className="flex items-center gap-2"
      >
        <Input
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          placeholder="新建一级标签…"
          className="h-8 max-w-xs text-sm"
          disabled={isPending}
        />
        <Button type="submit" size="sm" disabled={isPending || !newTagName.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          新建
        </Button>
      </form>

      {tags.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          还没有标签 — 在上面新建第一个标签。
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={tags.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1">
              {topLevel.map((tag) => (
                <TagRowGroup
                  key={tag.id}
                  tag={tag}
                  childrenTags={childByParent.get(tag.id) ?? []}
                  selected={selected}
                  isPending={isPending}
                  onToggleSelect={toggleSelect}
                  onCreateChild={handleCreate}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* Batch delete bar */}
      {someSelected ? (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 shadow-md">
          <span className="text-sm">
            已选 <strong>{selected.size}</strong> 个标签
          </span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={deleteSelected}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-4 w-4" />
            )}
            删除选中
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            disabled={isPending}
          >
            <X className="mr-1 h-4 w-4" />
            取消选择
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : null}
      {notice ? (
        <p className="text-sm text-muted-foreground" role="status">{notice}</p>
      ) : null}
    </div>
  );
}

/** Renders a top-level tag plus its children grouped underneath. */
function TagRowGroup({
  tag,
  childrenTags,
  selected,
  isPending,
  onToggleSelect,
  onCreateChild,
}: {
  tag: Tag;
  childrenTags: Tag[];
  selected: Set<number>;
  isPending: boolean;
  onToggleSelect: (id: number, name: string) => void;
  onCreateChild: (parentId: number | null) => void;
}) {
  return (
    <>
      <SortableRow
        tag={tag}
        selected={selected.has(tag.id)}
        isPending={isPending}
        onToggleSelect={onToggleSelect}
        onCreateChild={() => {
          const name = window.prompt(`为「#${tag.name}」创建子标签：`);
          if (name?.trim()) {
            // Quick inline creation
            fetch('/api/tags', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: name.trim(), parentId: tag.id }),
            })
              .then((r) => { if (r.ok) window.location.reload(); })
              .catch(() => {});
          }
        }}
      />
      {childrenTags.map((child) => (
        <SortableRow
          key={child.id}
          tag={child}
          selected={selected.has(child.id)}
          isPending={isPending}
          onToggleSelect={onToggleSelect}
          isChild
        />
      ))}
    </>
  );
}

function SortableRow({
  tag,
  selected,
  isPending,
  onToggleSelect,
  isChild,
  onCreateChild,
}: {
  tag: Tag;
  selected: boolean;
  isPending: boolean;
  onToggleSelect: (id: number, name: string) => void;
  isChild?: boolean;
  onCreateChild?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tag.id });

  const isFavorites = tag.name === FAVORITES_TAG_NAME;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md border bg-card px-3 py-2 transition-colors',
        isFavorites && 'border-primary/40 bg-primary/5',
        isDragging && 'opacity-60 shadow-lg',
        selected && 'ring-2 ring-primary',
        isChild && 'ml-6',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(tag.id, tag.name)}
        disabled={isFavorites || isPending}
        aria-label={isFavorites ? `${tag.name}（不可删除）` : `选择 ${tag.name}`}
        title={isFavorites ? '内置收藏标签不能删除' : '选择'}
        className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      />
      {isFavorites ? (
        <Star className="h-4 w-4 shrink-0 fill-primary text-primary" />
      ) : isChild ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <span className="inline-block h-4 w-4 shrink-0" />
      )}
      <span className="flex-1 truncate text-sm">
        <span className="font-medium">#{tag.name}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {tag.count} 篇
        </span>
        {isFavorites ? (
          <span className="ml-2 text-xs text-primary">（收藏）</span>
        ) : null}
      </span>
      {!isFavorites && !isChild && onCreateChild ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onCreateChild}
          title="新建子标签"
        >
          <Plus className="mr-1 h-3 w-3" />
          子标签
        </Button>
      ) : null}
      <button
        type="button"
        className={cn(
          'inline-flex h-8 w-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground',
          'hover:bg-muted active:cursor-grabbing',
        )}
        aria-label="拖动以重新排序"
        title="拖动以重新排序"
        {...attributes}
        {...listeners}
      >
        <span aria-hidden className="select-none text-lg leading-none">⋮⋮</span>
      </button>
    </li>
  );
}
