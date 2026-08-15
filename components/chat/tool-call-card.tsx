'use client';

// ToolCallCard: compact inline card shown in the assistant message
// stream when the agent invokes a tool. Three states:
//   - in_progress: spinner + "doing X…" label
//   - success: green check + "did X" label
//   - error: red x + "X failed" label
//
// Single-line height by default. A click on the header expands a
// region with the raw args + result (collapsible via aria-expanded).
// Card matches the existing chat stream typography — no jarring
// colors or large gaps.

import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';

import type { ToolCallState } from '@/lib/ai/tools/format-tool-result';
import { cn } from '@/lib/utils';

type Props = {
  /** Unique identifier for this specific invocation. Used for a11y
   *  (aria-controls) and React keys in the parent's render loop. */
  toolCallId: string;
  /** Tool name as exposed by Vercel AI SDK (e.g. "create_note"). */
  toolName: string;
  /** Current lifecycle state of this invocation. */
  state: ToolCallState;
  /** Arguments the LLM passed to the tool (raw, for the details panel). */
  args: unknown;
  /** Result returned by the tool, or undefined while in_progress. */
  result: unknown;
  /**
   * Pre-formatted one-line summary (typically produced by
   * formatToolResult on the SSE-consumption side).
   */
  summary: string;
};

export function ToolCallCard({
  toolCallId,
  toolName,
  state,
  args,
  result,
  summary,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const Icon =
    state === 'in_progress'
      ? Loader2
      : state === 'success'
        ? Check
        : X;
  const iconClass =
    state === 'in_progress'
      ? 'animate-spin text-muted-foreground'
      : state === 'success'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-destructive';

  // Per-invocation id so two parallel calls to the same tool (e.g.
  // two `create_note` in one turn) get unique aria-controls targets
  // — using toolName here would collide.
  const detailsId = `tc-details-${toolCallId}`;

  return (
    <div
      className={cn(
        'my-2 rounded-md border bg-muted/40 px-3 py-2 text-sm',
        state === 'error' && 'border-destructive/40 bg-destructive/5',
      )}
      data-tool={toolName}
      data-state={state}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="flex w-full items-center gap-2 text-left"
      >
        <Icon
          className={cn('h-3 w-3 shrink-0', iconClass)}
          aria-hidden="true"
        />
        <span className="flex-1 truncate">{summary}</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
      </button>
      {expanded ? (
        <div
          id={detailsId}
          className="mt-2 space-y-2 border-t border-border/50 pt-2 text-xs"
        >
          <div>
            <div className="font-medium text-foreground/80">参数</div>
            <pre className="mt-1 overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-snug">
              {safeStringify(args)}
            </pre>
          </div>
          {result !== undefined ? (
            <div>
              <div className="font-medium text-foreground/80">结果</div>
              <pre className="mt-1 overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-snug">
                {safeStringify(result)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Stringify with a try/catch around JSON.stringify (some args/result
// objects can contain circular refs from the LLM SDK).
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}