// Notes list (home) page. Master-detail layout (Outlook-style):
//   - top: header + welcome banner + toolbar + import/export
//   - left column:  scrollable list of notes (NoteListRow, with the
//                   currently-selected one highlighted)
//   - right column: detail of the selected note, or an empty state
//                   if no note is in scope
//
// URL state:
//   - `?q=<text>`  -> FTS search
//   - `?tag=<id>`  -> filter by tag (set by SidebarTagFilter)
//   - `?note=<id>` -> select a note for the right pane
//   - `?edit=1`    -> switch the selected note into edit mode
//   - all four are independent and combinable.

import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getNote,
  listNotes,
  listTagsWithCount,
} from '@/lib/notes/queries';
import { ImportExportBar } from '@/components/notes/import-export-bar';
import { NoteListWithSelection } from '@/components/notes/note-list-with-selection';
import { NotesToolbar } from '@/components/notes/notes-toolbar';
import { WelcomeBanner } from '@/components/notes/welcome-banner';
import { NoteDetailView } from '@/components/notes/note-detail-view';
import { Button } from '@/components/ui/button';
import { UNTAGGED_FILTER_ID } from '@/lib/notes/constants';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type PageProps = {
  searchParams?: {
    q?: string;
    tag?: string;
    note?: string;
    edit?: string;
    offset?: string;
  };
};

function parseTagId(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  if (!/^-?\d+$/.test(raw)) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseOffset(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function buildPageUrl(params: URLSearchParams, nextOffset: number): string {
  const p = new URLSearchParams(params);
  if (nextOffset <= 0) {
    p.delete('offset');
  } else {
    p.set('offset', String(nextOffset));
  }
  const qs = p.toString();
  return qs ? `/?${qs}` : '/';
}

export default function HomePage({ searchParams }: PageProps) {
  const q = searchParams?.q?.trim() || undefined;
  const tagId = parseTagId(searchParams?.tag);
  const noteId = searchParams?.note;
  const isEdit = searchParams?.edit === '1';
  const offset = parseOffset(searchParams?.offset);

  const { data: notes, total } = listNotes({ q, tagId, limit: PAGE_SIZE, offset });
  // The selected note is intentionally looked up OUTSIDE the filter
  // pipeline: if a user has a tag filter active and clicks a sidebar
  // tree entry that's not in the current list, we still want to show
  // the detail pane. `getNote` returns null for unknown ids -- the
  // right pane falls back to a "笔记不存在" hint.
  const selectedNote = noteId ? getNote(noteId) : null;
  // Pull every tag name for the edit-form's "从已有标签选择" dropdown.
  // Cheap: a single indexed SELECT over the tags table.
  const suggestedTags = listTagsWithCount().map((t) => t.name);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Top bar: welcome + toolbar (desktop only), search (both) */}
      <div className="flex shrink-0 flex-col gap-2">
        {/* Desktop: welcome banner + toolbar + import/export */}
        <div className="hidden md:flex md:flex-row md:items-center md:justify-between gap-2">
          <WelcomeBanner total={total} q={q} />
          <div className="flex flex-wrap items-center gap-2">
            <NotesToolbar />
            <ImportExportBar />
          </div>
        </div>
        {/* Mobile: search bar only */}
        <div className="md:hidden">
          <NotesToolbar />
        </div>
      </div>

      {/* Master-detail: on mobile, list only; on desktop, side-by-side */}
      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden md:grid-cols-[18rem_1fr]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <NoteListWithSelection
            notes={notes}
            selectedId={noteId}
            tagId={tagId}
            suggestedTags={suggestedTags}
            searchHeader={q ? (
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                <span className="text-sm">
                  以下为「<span className="font-medium text-foreground">{q}</span>」的搜索结果，共{' '}
                  <span className="font-medium text-foreground">{total}</span> 条
                </span>
                <Link
                  href="/"
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  返回全部
                </Link>
              </div>
            ) : undefined}
            pagination={total > PAGE_SIZE ? (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  {offset > 0 && (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={buildPageUrl(
                          new URLSearchParams({
                            ...(q ? { q } : {}),
                            ...(tagId ? { tag: String(tagId) } : {}),
                            ...(noteId ? { note: noteId } : {}),
                          }),
                          offset - PAGE_SIZE,
                        )}
                      >
                        <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                        上一页
                      </Link>
                    </Button>
                  )}
                  {offset + PAGE_SIZE < total && (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={buildPageUrl(
                          new URLSearchParams({
                            ...(q ? { q } : {}),
                            ...(tagId ? { tag: String(tagId) } : {}),
                            ...(noteId ? { note: noteId } : {}),
                          }),
                          offset + PAGE_SIZE,
                        )}
                      >
                        下一页
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  共 {total} 条，第 {offset + 1} – {Math.min(offset + PAGE_SIZE, total)} 条
                </span>
              </div>
            ) : undefined}
          />
        </aside>

        {/* Detail panel: desktop only (hidden on mobile — users navigate to /notes/[id]) */}
        <section className="hidden md:flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedNote ? (
              <NoteDetailView
                key={selectedNote.id}
                note={selectedNote}
                suggestedTags={suggestedTags}
                editMode={isEdit}
                highlightQuery={q}
              />
            ) : noteId ? (
              <div className="flex h-full items-center justify-center text-center text-muted-foreground">
                <div>
                  <p>笔记不存在或已删除</p>
                  <p className="mt-1 text-xs">id: {noteId}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-muted-foreground">
                <div>
                  <p>选择左侧笔记查看详情</p>
                  <p className="mt-1 text-xs">或点顶部「新建」开始</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
