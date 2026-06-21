'use client';

// S8 — interactive "生成摘要" button + live streaming card.
//
// Uses `fetch` (POST) + `ReadableStream` rather than `EventSource` because
// `EventSource` is GET-only and we want to keep the option of attaching a
// body later (e.g. overriding the model). The server sends SSE events
// `data: <json>\n\n`; we buffer, split on `\n\n`, parse, and append each
// delta to a single `streamed` text buffer (the spec is explicit: do NOT
// keep individual events in state — only the running concatenation).
//
// On `done` we trigger `router.refresh()` so the server-rendered static
// "摘要" card on the page updates with the newly persisted summary.

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AutoTagConfirm } from './auto-tag-confirm';

type SummaryState = 'none' | 'fresh' | 'stale' | 'generating';

type SseEvent =
  | { delta: string }
  | { done: true; summary: string; autoTags?: string[] }
  | { error: string };

type SummarizeButtonProps = {
  noteId: string;
  initialSummary: string | null;
  initialState: SummaryState;
};

type ApiError = { error?: string; message?: string };

export function SummarizeButton({
  noteId,
  initialSummary,
  initialState,
}: SummarizeButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<SummaryState>(initialState);
  const [streamed, setStreamed] = useState<string>(initialSummary ?? '');
  const [error, setError] = useState<string | null>(null);
  // AI-suggested tags captured from the `done` SSE event. When non-null,
  // the auto-tag confirmation panel is rendered below the streaming card
  // so the user can trim, extend, or accept the suggestions.
  const [autoTags, setAutoTags] = useState<string[] | null>(null);
  // Track the most recent in-flight controller so we can abort on unmount.
  const abortRef = useRef<AbortController | null>(null);

  const isGenerating = state === 'generating';
  const isFresh = state === 'fresh';
  const hasStreamed = streamed.length > 0;
  // Show the live streaming card only while we're actively streaming OR
  // when we have a partial stream + the note ended up stale (e.g. error
  // mid-stream, user can still see what we got). Once the stream completes
  // successfully, the page's static 摘要 card (from note.summary) takes
  // over -- showing both was the duplicate-summary bug.
  const showLiveCard = isGenerating || (state === 'stale' && hasStreamed);

  const onClick = useCallback(async () => {
    // Cancel any prior in-flight request (defensive — the button is disabled
    // while generating, but a double-click on fast hardware can still race).
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setStreamed('');
    setAutoTags(null);
    setState('generating');

    let res: Response;
    try {
      res = await fetch(`/api/notes/${noteId}/summarize`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      console.error('[summarize-button] request failed:', err);
      setError('网络错误，请重试');
      setState(initialState);
      return;
    }

    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as ApiError;
      setError(data.message ?? data.error ?? `请求失败 (${res.status})`);
      setState(initialState);
      return;
    }

    // Parse the SSE stream. We accumulate the running text in a local
    // variable (cheap; avoids a render per delta) and only commit to state
    // once per event so React batches efficiently.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    const flushEvent = (raw: string): SseEvent | null => {
      // An SSE event can have multiple lines; we only care about `data:` ones.
      const dataLine = raw
        .split('\n')
        .map((l) => l.trimEnd())
        .find((l) => l.startsWith('data: '));
      if (!dataLine) return null;
      const json = dataLine.slice('data: '.length);
      try {
        return JSON.parse(json) as SseEvent;
      } catch {
        return null;
      }
    };

    const commit = (next: string) => {
      // Batched state update — React will collapse consecutive calls inside
      // the same microtask, but we still call setStreamed once per event to
      // give the user a visible typing animation.
      setStreamed(next);
    };

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = flushEvent(raw);
          if (event) {
            if ('delta' in event) {
              accumulated += event.delta;
              commit(accumulated);
            } else if ('done' in event) {
              accumulated = event.summary;
              commit(accumulated);
              setState('fresh');
              setError(null);
              // Server always includes `autoTags` (possibly empty). Set
              // the panel state regardless so the user gets feedback
              // either way (chips to edit, or a "no suggestions"
              // message).
              if (Array.isArray(event.autoTags)) {
                setAutoTags(event.autoTags);
              }
              // Pull the fresh `summary` + `summaryState` from the server so
              // the parent page (and the static 摘要 card) reflect the new
              // state without a full reload.
              router.refresh();
            } else if ('error' in event) {
              setError(event.error);
              setState(initialState === 'generating' ? 'stale' : initialState);
            }
          }
          idx = buffer.indexOf('\n\n');
        }
      }

      // Stream closed without a terminal event — treat as a soft error so
      // the user knows the summary may be incomplete.
      if (state === 'generating') {
        setError((prev) => prev ?? '连接已中断，摘要可能不完整');
        setState(initialState === 'generating' ? 'stale' : initialState);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      console.error('[summarize-button] stream failed:', err);
      setError('网络错误，请重试');
      setState(initialState === 'generating' ? 'stale' : initialState);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [noteId, initialState, router, state]);

  const buttonLabel = isGenerating
    ? '生成中…'
    : isFresh || initialState === 'fresh'
      ? '重新生成'
      : '生成摘要';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={onClick}
          disabled={isGenerating}
          variant={isFresh ? 'outline' : 'default'}
          size="sm"
          aria-busy={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : isFresh ? (
            <RefreshCw className="mr-1 h-4 w-4" />
          ) : (
            <Sparkles className="mr-1 h-4 w-4" />
          )}
          {buttonLabel}
        </Button>
        {state === 'stale' ? (
          <span className="text-xs text-muted-foreground">
            笔记已修改，需要重新生成
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {showLiveCard ? (
        <div
          aria-live="polite"
          className="rounded-md border bg-muted/30 p-4 text-sm leading-relaxed"
        >
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            摘要{isGenerating ? '（生成中…）' : ''}
          </div>
          <p className="whitespace-pre-wrap text-foreground">
            {streamed}
            {isGenerating ? (
              <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse bg-foreground/60" />
            ) : null}
          </p>
        </div>
      ) : null}

      {autoTags ? (
        <AutoTagConfirm
          noteId={noteId}
          autoTags={autoTags}
          onDismiss={() => setAutoTags(null)}
        />
      ) : null}
    </div>
  );
}
