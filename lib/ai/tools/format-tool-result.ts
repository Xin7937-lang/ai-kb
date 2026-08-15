// lib/ai/tools/format-tool-result.ts
//
// Pure formatter that turns a tool's args + result into a one-line
// summary string for the ToolCallCard's collapsed state. The card's
// expanded view shows the raw args + result; this helper is the
// short text.
//
// Strings are Chinese to match the rest of the chat UI (e.g.
// "已保存为新笔记", "保存失败" in chat-window.tsx).

export type ToolCallState = 'in_progress' | 'success' | 'error';

export function formatToolResult(
  toolName: string,
  state: ToolCallState,
  args: unknown,
  result: unknown,
): string {
  if (toolName === 'create_note') {
    return formatCreateNote(state, args, result);
  }
  if (toolName === 'read_note') {
    return formatReadNote(state, args, result);
  }
  // Fallback for unknown tools (stage 2+).
  return `${state === 'in_progress' ? '执行中' : state === 'success' ? '成功' : '失败'}：${toolName}`;
}

function formatCreateNote(
  state: ToolCallState,
  args: unknown,
  result: unknown,
): string {
  if (state === 'in_progress') {
    const title = titleOf(args);
    return title ? `正在创建笔记《${title}》…` : '正在创建笔记…';
  }
  if (state === 'error') {
    const message = errorMessageOf(result);
    return `创建笔记失败：${message}`;
  }
  // success
  const title = titleOf(result) ?? titleOf(args);
  return title ? `已创建笔记《${title}》` : '已创建笔记';
}

function formatReadNote(
  state: ToolCallState,
  args: unknown,
  result: unknown,
): string {
  const isById = typeof (args as { noteId?: unknown } | null)?.noteId === 'string';
  if (state === 'in_progress') {
    return isById ? '正在读取笔记…' : '正在搜索笔记…';
  }
  if (state === 'error') {
    const errCode = (result as { error?: string } | null)?.error;
    if (errCode === 'note_not_found') return '笔记不存在';
    const message = errorMessageOf(result);
    return `读取笔记失败：${message}`;
  }
  // success
  if (isById) {
    const title = titleOf((result as { note?: { title?: string } } | null)?.note);
    return title ? `已读取笔记《${title}》` : '已读取笔记';
  }
  // query path
  const count = Array.isArray((result as { results?: unknown[] } | null)?.results)
    ? (result as { results: unknown[] }).results.length
    : 0;
  if (count === 0) return '没有找到匹配的笔记';
  return `找到 ${count} 条匹配的笔记`;
}

function titleOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const t = (value as { title?: unknown }).title;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

function errorMessageOf(result: unknown): string {
  if (typeof result !== 'object' || result === null) return 'unknown error';
  const r = result as { message?: unknown; error?: unknown };
  if (typeof r.message === 'string') return r.message;
  if (typeof r.error === 'string') return r.error;
  return 'unknown error';
}