// Welcome banner for the home page. Renders a greeting + key counts
// (total notes, last week, last month) and a row of the top tags for
// quick navigation. Server component — no client-side state.
//
// The `total` prop is the filtered count from the current page (so
// "共 12 篇" matches whatever's in the list). When no filter is
// active it equals the unfiltered total.

import Link from 'next/link';
import { BookOpen, CalendarDays, Sparkles, TrendingUp } from 'lucide-react';
import { getNoteStats } from '@/lib/notes/queries';
import { cn } from '@/lib/utils';

export function WelcomeBanner({ total, q }: { total: number; q?: string }) {
  const stats = getNoteStats();
  const greeting = pickGreeting();

  return (
    <section
      className={cn(
        'rounded-lg border bg-gradient-to-br from-card to-muted/40 px-4 py-3',
        'transition-shadow duration-200 hover:shadow-sm',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          {greeting}
        </h2>

        <span className="text-sm text-muted-foreground tabular-nums">
          共 <span className="font-semibold text-foreground">{total}</span> 篇
          {q ? (
            <span className="ml-1">· 搜索「{q}」</span>
          ) : null}
        </span>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <StatPill icon={<BookOpen className="h-3.5 w-3.5" />} label="总计" value={stats.total} />
          <StatPill
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            label="近 7 天"
            value={stats.lastWeek}
            highlight={stats.lastWeek > 0}
          />
          <StatPill
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label="近 30 天"
            value={stats.lastMonth}
          />
        </div>

        {stats.topTags.length > 0 ? (
          <div className="ml-auto flex max-w-full flex-wrap items-center gap-1.5">
            {stats.topTags.slice(0, 5).map((t) => (
              <Link
                key={t.id}
                href={`/?tag=${t.id}`}
                className={cn(
                  'rounded-full border bg-background px-2 py-0.5 text-xs',
                  'transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary',
                )}
              >
                #{t.name}
                <span className="ml-1 text-muted-foreground">{t.count}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StatPill({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1',
        'transition-colors duration-150',
        highlight
          ? 'border-primary/30 bg-primary/5 text-foreground'
          : 'bg-background text-muted-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </div>
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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < ONE_DAY_MS) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  if (diff < 7 * ONE_DAY_MS) return `${Math.floor(diff / ONE_DAY_MS)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
