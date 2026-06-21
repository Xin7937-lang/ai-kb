// (app) layout -- visible to authenticated users only.
// Owns the (app)-chrome shell: sidebar + main. Reads cookies for the
// session check (middleware would also block, but this is the
// server-side safety net for server components) and pre-fetches the tag
// data the sidebar needs.
//
// The header was removed in favor of putting the logout button at the
// bottom of the sidebar; that gives the main content area the full
// viewport height (each page decides its own top section).

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { listTagsWithCount, listTagsWithNotes, getNoteStats } from '@/lib/notes/queries';
import { getAppTitle } from '@/lib/auth/init';
import { AppSidebar } from './_components/app-sidebar';
import { MobileMenu } from './_components/mobile-menu';
import { ThemeToggle } from '@/components/ui/theme-toggle';

// This layout reads cookies via getSession() and the sidebar's tree
// data -- must run on every request.
export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  // Flat tag list (for the sidebar's search/filter dropdown) and the
  // per-tag recent-notes tree (for inline expansion). Both are cheap
  // SELECTs over the same `tags` row set; sharing the connection
  // through the singleton means the second one is just a few extra ms.
  const tags = listTagsWithCount();
  const tagsWithNotes = listTagsWithNotes({ maxPerTag: 3 });
  // Move 收藏 to the front so it's always the first tag in both
  // sidebar and mobile menu.
  const moveToFront = (a: { name: string }[]) => {
    const idx = a.findIndex((t) => t.name === '收藏');
    if (idx > 0) {
      const [item] = a.splice(idx, 1);
      a.unshift(item);
    }
  };
  moveToFront(tags);
  moveToFront(tagsWithNotes);
  const stats = getNoteStats();
  const appTitle = getAppTitle();

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar
        tags={tags}
        tagsWithNotes={tagsWithNotes}
        appTitle={appTitle}
      />
      <main className="relative flex-1 overflow-y-auto px-4 py-3 sm:px-6">
        <div className="absolute right-4 top-3 z-10 flex items-center gap-2">
          <MobileMenu
            stats={stats}
            tags={tags}
            tagsWithNotes={tagsWithNotes}
            appTitle={appTitle}
          />
          <ThemeToggle />
        </div>
        {children}
      </main>
    </div>
  );
}
