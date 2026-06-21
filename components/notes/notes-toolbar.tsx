'use client';

// Search input + "New" button. The list page is a server component; this
// toolbar is the only client-driven piece in it. It keeps the current `q`
// in local state and pushes it into the URL on submit (so refreshes / link
// shares preserve the search).

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function NotesToolbar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [, startTransition] = useTransition();

  function applySearch(nextQ: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextQ.trim()) {
      params.set('q', nextQ.trim());
    } else {
      params.delete('q');
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/?${qs}` : '/');
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    applySearch(q);
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <form onSubmit={onSubmit} className="relative flex-1 sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索标题或内容…"
          className="pl-9 pr-10"
          aria-label="搜索笔记"
        />
        {/*
          Visible submit button so the user has a clear, distinct click
          target instead of the (small) input edge or (worse) the
          neighbouring "新建" button. type="submit" inside the form so
          Enter-key submission and click both go through the same handler.
        */}
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          aria-label="搜索"
          title="搜索 (Enter)"
          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <Search className="h-4 w-4" />
        </Button>
      </form>
      <div className="hidden md:block">
        <Button asChild>
          <a href="/notes/new">
            <Plus className="mr-1 h-4 w-4" />
            新建
          </a>
        </Button>
      </div>
    </div>
  );
}
