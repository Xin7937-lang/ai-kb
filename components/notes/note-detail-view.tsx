// Read-only view of a single note. Used by the master-detail home page
// when a note is selected via `?note=<id>`. The edit form lives in
// NoteEditForm (a separate client component).
//
// Marked 'use client' for the in-page content search toggle — the
// component is still safe to render inside a server page.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download, Search } from 'lucide-react';
import { TiptapRenderer } from '@/components/editor/tiptap-renderer';
import { NoteEditForm } from './note-edit-form';
import { NoteTagsEditor } from './note-tags-editor';
import { NoteViewActions } from './note-view-actions';
import { SummarizeButton } from './summarize-button';
import { NoteSearchableContent } from './note-searchable-content';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { NoteFull } from '@/lib/notes/queries';

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NoteDetailView({
  note,
  suggestedTags,
  editMode,
  highlightQuery,
}: {
  note: NoteFull;
  suggestedTags: string[];
  editMode: boolean;
  highlightQuery?: string;
}) {
  const [searchVisible, setSearchVisible] = useState(!!highlightQuery);

  if (editMode) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">编辑笔记</h2>
          <div className="flex items-center gap-2">
            <Button type="submit" form="note-edit-form" size="sm">
              保存修改
            </Button>
            <Link
              href={`/?note=${note.id}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              取消编辑
            </Link>
          </div>
        </div>
        <NoteEditForm
          mode={{ kind: 'edit', note }}
          suggestedTags={suggestedTags}
          searchVisible={searchVisible}
          onToggleSearch={() => setSearchVisible((v) => !v)}
          highlightQuery={highlightQuery}
        />
      </div>
    );
  }

  const content = (
    <TiptapRenderer value={note.contentJson} />
  );

  return (
    <article className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold leading-tight">
          {note.title || '未命名笔记'}
        </h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>更新于 {formatDate(note.updatedAt)}</span>
          <span aria-hidden>·</span>
          <span>创建于 {formatDate(note.createdAt)}</span>
        </div>
        <div className="pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <NoteViewActions note={note} />
            <Button
              variant={searchVisible ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSearchVisible((v) => !v)}
              title="页内搜索 (Ctrl+F)"
              aria-label="页内搜索"
            >
              <Search className="mr-1 h-4 w-4" />
              页内搜索
            </Button>
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/export?scope=note&id=${encodeURIComponent(note.id)}`}
                download
              >
                <Download className="mr-1 h-4 w-4" />
                导出
              </a>
            </Button>
            <SummarizeButton
              noteId={note.id}
              initialSummary={note.summary}
              initialState={note.summaryState}
            />
          </div>
        </div>
        <div className="pt-2">
          <NoteTagsEditor
            noteId={note.id}
            initialTags={note.tags}
            suggestions={suggestedTags}
          />
        </div>
      </div>

      {note.summary ? (
        <Card className="bg-muted/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">摘要</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {note.summary}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {searchVisible ? (
        <NoteSearchableContent
          contentText={note.contentText}
          onClose={() => setSearchVisible(false)}
        >
          {content}
        </NoteSearchableContent>
      ) : (
        content
      )}
    </article>
  );
}
