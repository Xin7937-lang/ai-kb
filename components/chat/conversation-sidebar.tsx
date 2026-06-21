'use client';

// Conversation history sidebar for the chat page.
// Shows a list of past conversations with checkboxes for batch deletion.

import { useState, useCallback } from 'react';
import { Plus, Trash2, MessageSquare, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { ConversationSummary } from '@/lib/chat/queries';

type Props = {
  conversations: ConversationSummary[];
  activeId: string | null;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onToggleSelect: (id: string) => void;
  onBatchDelete: () => void;
  isDeleting: boolean;
  isCreating: boolean;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function ConversationSidebar({
  conversations,
  activeId,
  selectedIds,
  onSelect,
  onNew,
  onToggleSelect,
  onBatchDelete,
  isDeleting,
  isCreating,
}: Props) {
  const hasSelection = selectedIds.size > 0;

  return (
    <div className="flex h-full w-64 flex-col border-r bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          对话历史
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onNew}
          disabled={isCreating}
          className="h-7 px-2 text-xs"
        >
          {isCreating ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Plus className="mr-1 h-3 w-3" />
          )}
          新对话
        </Button>
      </div>

      {/* Batch delete bar */}
      {hasSelection && (
        <div className="flex items-center justify-between border-b bg-destructive/10 px-3 py-1.5">
          <span className="text-xs text-destructive">
            已选 {selectedIds.size} 项
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={onBatchDelete}
            disabled={isDeleting}
            className="h-7 px-2 text-xs"
          >
            {isDeleting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3 w-3" />
            )}
            删除
          </Button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            暂无对话记录
          </p>
        ) : (
          conversations.map((conv) => {
            const isActive = conv.id === activeId;
            const isSelected = selectedIds.has(conv.id);
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv.id)}
                className={cn(
                  'group flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent text-accent-foreground',
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(conv.id);
                  }}
                  onChange={() => {}} // React requires this with checked
                  className="mt-0.5 shrink-0"
                  aria-label={`选择 ${conv.title}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span
                      className={cn(
                        'truncate text-xs font-medium',
                        isActive ? 'text-foreground' : 'text-foreground/80',
                      )}
                    >
                      {conv.title}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{conv.messageCount} 条消息</span>
                    <span>{formatTime(conv.updatedAt)}</span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
