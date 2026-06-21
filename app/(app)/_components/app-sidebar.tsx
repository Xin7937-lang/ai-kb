'use client';

// Left sidebar: app title (customizable in Settings → General), primary
// nav, tag filter (searchable dropdown), hierarchical tag tree, settings
// link, and the logout button pinned to the bottom. All primary nav
// items use the SAME NavLink component so icon size, font, and hover
// animation are consistent. Active route is highlighted via
// usePathname(); the active tag in the tree is auto-expanded via
// useSearchParams().

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import {
  FilePlus,
  FileText,
  Globe,
  LogOut,
  MessageSquare,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Tag, TagWithNotes } from '@/lib/notes/queries';
import { TagTree } from './tag-tree';
import { SidebarTagFilter } from '@/components/notes/sidebar-tag-filter';

export function AppSidebar({
  tags,
  tagsWithNotes,
  appTitle,
}: {
  tags: Tag[];
  tagsWithNotes: TagWithNotes[];
  appTitle: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-muted/30">
      <div className="px-4 py-4">
        <Link
          href="/"
          className="group flex items-center gap-2 text-base font-semibold tracking-tight transition-colors hover:text-primary"
        >
          <Sparkles className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary" />
          <span className="truncate">{appTitle}</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-2 pb-4">
        <div className="space-y-1">
          <NavLink href="/notes/new" active={pathname === '/notes/new'}>
            <FilePlus className="mr-2 h-4 w-4" />
            新建笔记
          </NavLink>
          <NavLink href="/" active={pathname === '/'}>
            <FileText className="mr-2 h-4 w-4" />
            所有笔记
          </NavLink>
          <NavLink href="/chat" active={pathname === '/chat'}>
            <MessageSquare className="mr-2 h-4 w-4" />
            与笔记对话
          </NavLink>
          <NavLink href="/reader" active={pathname === '/reader'}>
            <Globe className="mr-2 h-4 w-4" />
            网页读取
          </NavLink>
        </div>

        <div className="space-y-2">
          <h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            筛选
          </h2>
          <SidebarTagFilter tags={tags} />
          <h2 className="mt-3 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            标签
          </h2>
          <TagTree tagsWithNotes={tagsWithNotes} />
        </div>

        <div className="space-y-1">
          <h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            系统
          </h2>
          <NavLink
            href="/settings/models"
            active={pathname.startsWith('/settings')}
          >
            <SettingsIcon className="mr-2 h-4 w-4" />
            设置
          </NavLink>
        </div>
      </nav>

      <div className="border-t p-2">
        <SidebarLogoutButton />
      </div>
    </aside>
  );
}

function SidebarLogoutButton() {
  // Tiny client island: posts /api/auth/logout then redirects to /login.
  // Duplicates a few lines of `LogoutButton` so we can render the icon
  // + label inline with full-width + justify-start styling.
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  function handleClick() {
    startTransition(async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    });
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={isPending}
      className="w-full justify-start"
    >
      <LogOut className="mr-2 h-4 w-4" />
      {isPending ? '退出中…' : '退出'}
    </Button>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center rounded-md px-2 py-1.5 text-sm',
        'transition-all duration-150',
        'hover:bg-accent hover:text-accent-foreground hover:translate-x-0.5',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </Link>
  );
}
