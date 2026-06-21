// /notes/[id] — standalone note detail page (primary nav-target on mobile,
// still reachable from desktop sidebar tree entries).
//
// On desktop the master-detail home page (/?note=<id>) is the main UX, so
// this page adds a "返回列表" link that points back to /?note=<id>.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getNote, listTagsWithCount } from '@/lib/notes/queries';
import { NoteDetailView } from '@/components/notes/note-detail-view';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: { id: string };
  searchParams?: { edit?: string };
};

export default function NoteDetailPage({ params, searchParams }: PageProps) {
  const note = getNote(params.id);
  const isEdit = searchParams?.edit === '1';
  // Tags for the edit form's "从已有标签选择" dropdown.
  const suggestedTags = listTagsWithCount().map((t) => t.name);

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">笔记不存在或已删除</p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm text-primary hover:underline"
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">
      <Link
        href={`/?note=${params.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        返回列表
      </Link>
      <NoteDetailView
        key={note.id}
        note={note}
        suggestedTags={suggestedTags}
        editMode={isEdit}
      />
    </div>
  );
}
