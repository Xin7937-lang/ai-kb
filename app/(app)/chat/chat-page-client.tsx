'use client';

// Client-side chat page shell. Manages conversation list state,
// active conversation selection, and delegates the chat UI to
// ChatWindow. The server component (page.tsx) passes the initial
// conversation list from the DB.

import { useState, useCallback, useEffect, useTransition } from 'react';
import { Menu } from 'lucide-react';
import { ConversationSidebar } from '@/components/chat/conversation-sidebar';
import { ChatWindow } from '@/components/chat/chat-window';
import type { ConversationSummary } from '@/lib/chat/queries';

type Props = {
  initialConversations: ConversationSummary[];
};

export function ChatPageClient({ initialConversations }: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    initialConversations,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCreating, startCreate] = useTransition();
  const [isDeleting, startDelete] = useTransition();

  // Refresh conversation list from API
  const refreshList = useCallback(() => {
    fetch('/api/chat/conversations')
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setConversations(json.data as ConversationSummary[]);
      })
      .catch(() => {}); // silently ignore fetch errors
  }, []);

  // Create a new conversation
  const handleNew = useCallback(() => {
    startCreate(async () => {
      try {
        const res = await fetch('/api/chat/conversations', { method: 'POST' });
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: { id: string };
        };
        setActiveId(json.data.id);
        setSelectedIds(new Set());
        await refreshList();
      } catch {
        // ignore
      }
    });
  }, [refreshList]);

  // Select a conversation
  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  // Toggle checkbox for batch selection
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Batch delete
  const handleBatchDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    startDelete(async () => {
      try {
        const res = await fetch('/api/chat/conversations/batch-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) return;
        setSelectedIds(new Set());
        // If the active conversation was deleted, switch to the first
        // remaining or null.
        if (activeId && ids.includes(activeId)) {
          setActiveId(null);
        }
        await refreshList();
      } catch {
        // ignore
      }
    });
  }, [selectedIds, activeId, refreshList]);

  // Called by ChatWindow after a turn is saved — refresh the sidebar list
  const handleTurnSaved = useCallback(() => {
    refreshList();
  }, [refreshList]);

  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  const sidebarEl = (
    <ConversationSidebar
      conversations={conversations}
      activeId={activeId}
      selectedIds={selectedIds}
      onSelect={(id) => {
        handleSelect(id);
        setShowMobileSidebar(false);
      }}
      onNew={handleNew}
      onToggleSelect={handleToggleSelect}
      onBatchDelete={handleBatchDelete}
      isDeleting={isDeleting}
      isCreating={isCreating}
    />
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-lg border">
      {/* Overlay sidebar (both mobile and desktop) */}
      {showMobileSidebar && (
        <div className="fixed inset-0 z-50">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setShowMobileSidebar(false)}
          />
          <div className="fixed inset-y-0 left-0 z-10 animate-in slide-in-from-left">
            <div className="h-full bg-background shadow-xl border-r">
              {sidebarEl}
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-center gap-2 px-4 pt-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setShowMobileSidebar(true)}
          >
            <Menu className="h-4 w-4" />
            对话历史
          </button>
          <h1 className="text-lg font-semibold">与笔记对话</h1>
        </div>
        <ChatWindow
          conversationId={activeId}
          onTurnSaved={handleTurnSaved}
        />
      </div>
    </div>
  );
}
