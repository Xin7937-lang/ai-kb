'use client';

// Mobile hamburger menu — slide-out drawer from the right, containing
// everything that's normally in the sidebar + welcome banner on desktop.
// Only rendered on screens < md (the trigger button is hidden on md+).

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FilePlus,
  FileText,
  LogOut,
  Menu,
  Globe,
  MessageSquare,
  Settings as SettingsIcon,
  Sparkles,
  X,
  BookOpen,
  CalendarDays,
  TrendingUp,
  Download,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NoteStats, Tag, TagWithNotes } from '@/lib/notes/queries';
import { SidebarTagFilter } from '@/components/notes/sidebar-tag-filter';
import { TagTree } from './tag-tree';

type Props = {
  stats: NoteStats;
  tags: Tag[];
  tagsWithNotes: TagWithNotes[];
  appTitle: string;
};

export function MobileMenu({ stats, tags, tagsWithNotes, appTitle }: Props) {
  const [open, setOpen] = useState(false);
  const greeting = pickGreeting();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Lock body scroll when menu is open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function logout() {
    startTransition(async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    });
  }

  function openImportPicker() {
    setImportStatus(null);
    fileInputRef.current?.click();
  }

  function onImportFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length === 0) return;
    startTransition(async () => {
      try {
        const form = new FormData();
        for (const file of files) form.append('file', file);
        const res = await fetch('/api/import', { method: 'POST', body: form });
        const payload = await res.json().catch(() => ({})) as {
          data?: { imported?: number; errors?: { length: number } };
        };
        if (!res.ok) {
          setImportStatus('导入失败');
          return;
        }
        const imported = payload.data?.imported ?? 0;
        const errors = payload.data?.errors?.length ?? 0;
        if (imported === 0 && errors > 0) {
          setImportStatus('导入失败');
        } else if (errors > 0) {
          setImportStatus(`已导入 ${imported} 篇（${errors} 个失败）`);
        } else {
          setImportStatus(`已导入 ${imported} 篇`);
        }
        router.refresh();
      } catch {
        setImportStatus('网络错误');
      }
    });
  }

  return (
    <>
      {/* Trigger button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="打开菜单"
        className="md:hidden"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Overlay */}
      {open ? (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="导航菜单"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Drawer panel */}
          <div className="absolute right-0 top-0 bottom-0 w-72 bg-background shadow-xl border-l animate-in slide-in-from-right">
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <Link
                  href="/"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 text-sm font-semibold"
                >
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{appTitle}</span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(false)}
                  aria-label="关闭菜单"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Greeting + stats */}
              <div className="px-4 py-3 border-b space-y-2 bg-muted/20">
                <p className="text-sm font-medium">{greeting}</p>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5">
                    <BookOpen className="h-3 w-3" />
                    <span>总计</span>
                    <span className="font-semibold">{stats.total}</span>
                  </span>
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
                    stats.lastWeek > 0
                      ? 'border-primary/30 bg-primary/5'
                      : 'bg-background text-muted-foreground',
                  )}>
                    <TrendingUp className="h-3 w-3" />
                    <span>7天</span>
                    <span className="font-semibold">{stats.lastWeek}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    <span>30天</span>
                    <span className="font-semibold">{stats.lastMonth}</span>
                  </span>
                </div>
              </div>

              {/* Navigation links */}
              <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
                <MenuLink href="/notes/new" onClick={() => setOpen(false)}>
                  <FilePlus className="mr-2 h-4 w-4" />
                  新建笔记
                </MenuLink>
                <MenuLink href="/" onClick={() => setOpen(false)}>
                  <FileText className="mr-2 h-4 w-4" />
                  所有笔记
                </MenuLink>
                <MenuLink href="/chat" onClick={() => setOpen(false)}>
                  <MessageSquare className="mr-2 h-4 w-4" />
                  与笔记对话
                </MenuLink>
                <MenuLink href="/reader" onClick={() => setOpen(false)}>
                  <Globe className="mr-2 h-4 w-4" />
                  网页读取
                </MenuLink>

                {/* Tag filter */}
                <div className="pt-3 pb-1">
                  <h3 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    筛选
                  </h3>
                </div>
                <div className="px-1">
                  <SidebarTagFilter tags={tags} />
                </div>

                {/* Tag tree */}
                <div className="pt-3 pb-1">
                  <h3 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    标签
                  </h3>
                </div>
                <div className="px-1">
                  {tagsWithNotes.length === 0 ? (
                    <p className="px-2 text-xs text-muted-foreground">还没有标签</p>
                  ) : (
                    <TagTree tagsWithNotes={tagsWithNotes} />
                  )}
                </div>

                <div className="pt-3 pb-1">
                  <h3 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    导入 / 导出
                  </h3>
                </div>
                {/* Hidden file input for import */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.mdown,.mkd,.txt,.zip"
                  multiple
                  className="hidden"
                  onChange={onImportFiles}
                  aria-hidden
                  tabIndex={-1}
                />
                <button
                  type="button"
                  onClick={openImportPicker}
                  disabled={isPending}
                  className={cn(
                    'flex w-full items-center rounded-md px-2 py-1.5 text-sm',
                    'transition-all duration-150',
                    'hover:bg-accent hover:text-accent-foreground',
                    isPending && 'opacity-50',
                  )}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {isPending ? '导入中…' : '导入笔记'}
                </button>
                {importStatus ? (
                  <p className="px-2 text-xs text-muted-foreground">{importStatus}</p>
                ) : null}
                <MenuLink href="/api/export?scope=all" onClick={() => setOpen(false)}>
                  <Download className="mr-2 h-4 w-4" />
                  导出全部
                </MenuLink>

                <div className="pt-3 pb-1">
                  <h3 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    系统
                  </h3>
                </div>
                <MenuLink href="/settings/models" onClick={() => setOpen(false)}>
                  <SettingsIcon className="mr-2 h-4 w-4" />
                  设置
                </MenuLink>
              </nav>

              {/* Logout at bottom */}
              <div className="border-t p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  disabled={isPending}
                  className="w-full justify-start"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {isPending ? '退出中…' : '退出'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex items-center rounded-md px-2 py-1.5 text-sm',
        'transition-all duration-150',
        'hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {children}
    </Link>
  );
}

function pickGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return '夜深了，早点休息';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  if (h < 22) return '晚上好';
  return '夜深了';
}
