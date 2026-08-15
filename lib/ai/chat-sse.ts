// lib/ai/chat-sse.ts
//
// Pure mapping from Vercel AI SDK stream parts to the SSE event payloads
// that chat-window.tsx consumes. Extracted so each branch can be unit-
// tested in isolation (the rest of streamChat is too entangled with
// better-sqlite3 / providers / SSE encoding to test directly).
//
// Parts we don't expose yet (return null):
//   - tool-call-streaming-start / tool-call-delta: streaming args for
//     very long tool inputs. Stage 1 cards don't need them; the
//     consolidated tool-call event with `args` is sufficient.
//   - step-finish / finish: caller (streamChat) emits its own 'done'
//     event after the loop ends, with the accumulated text. Skipping
//     these here keeps the mapper focused on per-part payloads.
//
// Input is typed `unknown` rather than `TextStreamPart<TOOLS>` so the
// mapper doesn't depend on the tools generic — fullStream yields
// parts typed against the actual tools map, which makes the call
// site cleaner than threading TOOLS through here.

export type SseEvent =
  | { type: 'delta'; delta: string }
  | {
      type: 'tool_call';
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: 'tool_result';
      toolCallId: string;
      toolName: string;
      result: unknown;
    }
  | { type: 'error'; error: string };

// Narrow a stream part to one of the four shape variants we care about.
// Returns null when the part isn't one we map.
function isToolCallPart(
  part: unknown,
): part is { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown } {
  if (typeof part !== 'object' || part === null) return false;
  const p = part as { type?: unknown };
  return p.type === 'tool-call';
}

function isToolResultPart(
  part: unknown,
): part is { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown } {
  if (typeof part !== 'object' || part === null) return false;
  const p = part as { type?: unknown };
  return p.type === 'tool-result';
}

export function mapStreamPartToSseEvent(part: unknown): SseEvent | null {
  if (typeof part !== 'object' || part === null) return null;
  const p = part as { type?: unknown };

  switch (p.type) {
    case 'text-delta': {
      const td = part as { textDelta?: unknown };
      if (typeof td.textDelta !== 'string') return null;
      return { type: 'delta', delta: td.textDelta };
    }
    case 'tool-call':
      return isToolCallPart(part)
        ? {
            type: 'tool_call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.args,
          }
        : null;
    case 'tool-result':
      return isToolResultPart(part)
        ? {
            type: 'tool_result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            result: part.result,
          }
        : null;
    case 'error': {
      const e = part as { error?: unknown };
      const message =
        e.error instanceof Error ? e.error.message : String(e.error);
      return { type: 'error', error: message };
    }
    // These Vercel AI SDK parts aren't surfaced to the client yet.
    // finish / step-finish → caller (streamChat) emits its own 'done'
    //   event after the loop with accumulated text.
    // tool-call-streaming-start / tool-call-delta → streaming args for
    //   very long inputs; stage-1 cards work without them.
    case 'finish':
    case 'step-finish':
    case 'tool-call-streaming-start':
    case 'tool-call-delta':
    default:
      return null;
  }
}