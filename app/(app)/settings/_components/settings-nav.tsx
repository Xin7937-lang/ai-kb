'use client';

// Sub-navigation for the settings section. Two entries: Models (already
// implemented) and Account (change password).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Globe, KeyRound, Settings as GeneralIcon, Tag as TagIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/settings/general', label: '常规', icon: GeneralIcon },
  { href: '/settings/models', label: '模型', icon: Bot },
  { href: '/settings/tags', label: '标签', icon: TagIcon },
  { href: '/settings/search', label: '搜索', icon: Globe },
  { href: '/settings/account', label: '账户与密码', icon: KeyRound },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="space-y-1">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              'transition-all duration-150',
              'hover:bg-accent hover:text-accent-foreground hover:translate-x-0.5',
              active && 'bg-accent text-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
