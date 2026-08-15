// lib/ai/tools/format-tool-result.ts
//
// Pure formatter that turns a tool's args + result into a one-line
// summary string for the ToolCallCard's collapsed state. The card's
// expanded view shows the raw args + result; this helper is the
// short text.
//
// Strings are Chinese to match the rest of the chat UI (e.g.
// "已保存为新笔记", "保存失败" in chat-window.tsx).
//
// ToolCallState is the lifecycle state for a single agent tool
// invocation. Defined here (the helper file) and imported by both
// the component (components/chat/tool-call-card.tsx) and the SSE
// consumer (components/chat/chat-window.tsx) so there's exactly one
// canonical declaration.

export type ToolCallState = 'in_progress' | 'success' | 'error';

// Tool result shapes from lib/ai/tools/{create_note,read_note,edit_note,delete_note}.ts.
// Narrow helpers extract fields defensively — never cast.

function noteIdOf(args: unknown): string | null {
  const v = stringFieldOf(args, 'noteId');
  return v && v.length > 0 ? v : null;
}

function queryOf(args: unknown): string | null {
  const v = stringFieldOf(args, 'query');
  return v && v.length > 0 ? v : null;
}

function titleOf(value: unknown): string | null {
  const v = stringFieldOf(value, 'title');
  return v && v.length > 0 ? v : null;
}

function errorCodeOf(result: unknown): string | null {
  const v = stringFieldOf(result, 'error');
  return v && v.length > 0 ? v : null;
}

function errorMessageOf(result: unknown): string {
  const v = stringFieldOf(result, 'message');
  if (v) return v;
  // Fall back to the error code if no human-readable message was
  // attached (some error shapes do this — e.g. note_not_found).
  const code = errorCodeOf(result);
  return code ?? 'unknown error';
}

function noteOf(result: unknown): { title?: string } | null {
  if (typeof result !== 'object' || result === null) return null;
  const n = (result as { note?: unknown }).note;
  return typeof n === 'object' && n !== null ? (n as { title?: string }) : null;
}

function resultsOf(result: unknown): unknown[] {
  if (typeof result !== 'object' || result === null) return [];
  const r = (result as { results?: unknown }).results;
  return Array.isArray(r) ? r : [];
}

function updatesOf(args: unknown): { title?: string } | null {
  if (typeof args !== 'object' || args === null) return null;
  const u = (args as { updates?: unknown }).updates;
  return typeof u === 'object' && u !== null ? (u as { title?: string }) : null;
}

function stringFieldOf(value: unknown, field: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = (value as Record<string, unknown>)[field];
  return typeof v === 'string' ? v : null;
}

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
  if (toolName === 'edit_note') {
    return formatEditNote(state, args, result);
  }
  if (toolName === 'delete_note') {
    return formatDeleteNote(state, args, result);
  }
  // Fallback for unknown tools.
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
    const code = errorCodeOf(result);
    const message = errorMessageOf(result);
    // For create_failed the cause is the message; no need to repeat
    // the code (would be redundant). For other codes surface the code
    // so the LLM can correlate with the contract (spec.md §Error codes).
    return code && code !== 'create_failed'
      ? `创建笔记失败 [${code}]：${message}`
      : `创建笔记失败：${message}`;
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
  const isById = noteIdOf(args) !== null;
  if (state === 'in_progress') {
    return isById ? '正在读取笔记…' : '正在搜索笔记…';
  }
  if (state === 'error') {
    const code = errorCodeOf(result);
    // note_not_found is self-explanatory in Chinese; surface the code
    // for less common failures so the LLM can correlate.
    if (code === 'note_not_found') return '笔记不存在';
    const message = errorMessageOf(result);
    return code ? `读取笔记失败 [${code}]：${message}` : `读取笔记失败：${message}`;
  }
  // success
  if (isById) {
    const title = titleOf(noteOf(result));
    return title ? `已读取笔记《${title}》` : '已读取笔记';
  }
  // query path
  const count = resultsOf(result).length;
  if (count === 0) return '没有找到匹配的笔记';
  return `找到 ${count} 条匹配的笔记`;
}

function formatEditNote(
  state: ToolCallState,
  args: unknown,
  result: unknown,
): string {
  if (state === 'in_progress') {
    const updateTitle = titleOf(updatesOf(args));
    return updateTitle ? `正在编辑笔记为《${updateTitle}》…` : '正在编辑笔记…';
  }
  if (state === 'error') {
    const code = errorCodeOf(result);
    const message = errorMessageOf(result);
    if (code === 'note_not_found') return '要编辑的笔记不存在';
    return code ? `编辑笔记失败 [${code}]：${message}` : `编辑笔记失败：${message}`;
  }
  // success
  const updateTitle = titleOf(updatesOf(args));
  const resultTitle = titleOf(result);
  return resultTitle || updateTitle
    ? `已编辑笔记《${resultTitle ?? updateTitle}》`
    : '已编辑笔记';
}

function formatDeleteNote(
  state: ToolCallState,
  _args: unknown,
  result: unknown,
): string {
  if (state === 'in_progress') {
    return '正在删除笔记…';
  }
  if (state === 'error') {
    const code = errorCodeOf(result);
    const message = errorMessageOf(result);
    if (code === 'note_not_found') return '要删除的笔记不存在';
    return code ? `删除笔记失败 [${code}]：${message}` : `删除笔记失败：${message}`;
  }
  // success
  const noteId = noteIdOf(result) ?? stringFieldOf(result, 'noteId');
  return noteId ? `已删除笔记 ${noteId}` : '已删除笔记';
}
