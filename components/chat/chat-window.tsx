'use client';

// RAG-lite chat UI:
//   - Bottom-anchored input that posts to /api/chat
//   - SSE stream parsed into live text in the assistant message bubble
//   - Sources panel listing the notes the model used as context
//   - When `conversationId` is provided, turns are persisted via
//     POST /api/chat/conversations/[id] after each SSE response.

import {
  useState,
  useRef,
  useEffect,
  useTransition,
  type FormEvent,
} from 'react';
import { Loader2, Send, Sparkles, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Source = { id: string; title: string };

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: Source[];
  error?: string;
  streaming?: boolean;
  isWebSearch?: boolean;
};

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: '问我任何关于你笔记的问题。我会搜索你的笔记库并基于找到的内容回答。',
};

type Props = {
  /** If non-null, turns are persisted to this conversation. */
  conversationId: string | null;
  /** Called after a turn is successfully saved to the server. */
  onTurnSaved?: () => void;
};

export function ChatWindow({ conversationId, onTurnSaved }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [isPending, startTransition] = useTransition();
  const [isLoading, startLoad] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<Source[]>([]);
  const [saveNoteHint, setSaveNoteHint] = useState<string | null>(null);

  function findUserMessageFor(assistantId: string): ChatMessage | undefined {
    const idx = messages.findIndex((m) => m.id === assistantId);
    if (idx <= 0) return undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i];
    }
    return undefined;
  }

  async function saveAsNote(assistantMsg: ChatMessage) {
    const userMsg = findUserMessageFor(assistantMsg.id);
    const titlePrefix = userMsg ? userMsg.text.slice(0, 20) : '对话摘录';
    const title = `对话：${titlePrefix}${userMsg && userMsg.text.length > 20 ? '…' : ''}`;

    const now = new Date().toLocaleString('zh-CN');
    const paragraphs = [
      `用户提问：${userMsg?.text || ''}`,
      '',
      `AI 回答：`,
      assistantMsg.text,
      '',
      `---`,
      `保存自对话记录，${now}`,
    ];

    const contentJson = {
      type: 'doc',
      content: paragraphs.map((text) => ({
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : [],
      })),
    };

    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        contentJson,
        contentText: paragraphs.join('\n'),
      }),
    });
    if (!res.ok) {
      throw new Error('save failed');
    }
    setSaveNoteHint('已保存为新笔记');
    setTimeout(() => setSaveNoteHint(null), 2000);
  }

  // Load messages when conversationId changes.
  useEffect(() => {
    if (!conversationId) {
      setMessages([WELCOME]);
      return;
    }
    startLoad(async () => {
      try {
        const res = await fetch(
          `/api/chat/conversations/${conversationId}`,
        );
        if (!res.ok) {
          setMessages([WELCOME]);
          return;
        }
        const json = (await res.json()) as {
          data: { messages: Array<{ id: string; role: string; content: string; sources: Source[] | null }> };
        };
        const msgs = json.data.messages;
        if (msgs.length === 0) {
          setMessages([WELCOME]);
        } else {
          setMessages(
            msgs.map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              text: m.content,
              sources: m.sources ?? undefined,
            })),
          );
        }
      } catch {
        setMessages([WELCOME]);
      }
    });
  }, [conversationId]);

  function appendMessage(m: ChatMessage) {
    setMessages((prev) => [...prev, m]);
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }

  function updateLastAssistant(updater: (m: ChatMessage) => ChatMessage) {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant' && next[i].streaming) {
          next[i] = updater(next[i]);
          break;
        }
      }
      return next;
    });
  }

  async function saveTurn(
    convId: string,
    userContent: string,
    assistantContent: string,
    sources: Source[],
  ) {
    try {
      await fetch(`/api/chat/conversations/${convId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userContent,
          assistantContent,
          sources,
        }),
      });
      onTurnSaved?.();
    } catch {
      // silently ignore save errors — the chat experience isn't blocked
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || isPending) return;
    setInput('');

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: msg,
    };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      text: '',
      sources: [],
      streaming: true,
    };
    appendMessage(userMsg);
    appendMessage(assistantMsg);
    sourcesRef.current = [];

    startTransition(async () => {
      try {
        const history = [
          ...messages
            .filter((m) => m.id !== 'welcome' && !m.streaming && m.text)
            .map((m) => ({ role: m.role, content: m.text })),
          { role: 'user', content: msg },
        ];

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          updateLastAssistant((m) => ({
            ...m,
            error: data.message ?? data.error ?? '请求失败',
            streaming: false,
          }));
          return;
        }
        await consumeSse(res.body, {
          onSources: (sources, isWebSearch) => {
            sourcesRef.current = sources;
            updateLastAssistant((m) => ({ ...m, sources, isWebSearch }));
          },
          onDelta: (delta) => {
            updateLastAssistant((m) => ({ ...m, text: m.text + delta }));
          },
          onDone: (fullText) => {
            updateLastAssistant((m) => ({ ...m, streaming: false }));
            if (conversationId) {
              saveTurn(conversationId, msg, fullText, sourcesRef.current);
            }
          },
          onError: (errMsg) => {
            updateLastAssistant((m) => ({
              ...m,
              error: errMsg,
              streaming: false,
            }));
          },
        });
      } catch (err) {
        console.error('[chat-window] fetch failed:', err);
        updateLastAssistant((m) => ({
          ...m,
          error: '网络错误，请重试',
          streaming: false,
        }));
      }
    });
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onSaveAsNote={saveAsNote}
              />
            ))
          )}
        </div>
      </div>
      {saveNoteHint ? (
        <div className="border-t bg-background px-4 py-1.5 text-center text-xs text-emerald-600 dark:text-emerald-400">
          {saveNoteHint}
        </div>
      ) : null}
      <form
        onSubmit={onSubmit}
        className="mx-auto flex w-full max-w-3xl items-end gap-2 border-t bg-background px-3 py-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          rows={2}
          placeholder="问一个关于你笔记的问题…  (Shift+Enter 换行)"
          className={cn(
            'flex-1 resize-none overflow-y-auto rounded-md border bg-background px-3 py-2 text-sm',
            'transition-colors focus:border-primary/40 focus:outline-none',
            'disabled:opacity-50',
          )}
          disabled={isPending}
        />
        <Button type="submit" disabled={isPending || !input.trim()}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  onSaveAsNote,
}: {
  message: ChatMessage;
  onSaveAsNote?: (msg: ChatMessage) => void;
}) {
  const [showSources, setShowSources] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const isUser = message.role === 'user';

  async function handleSave() {
    if (!onSaveAsNote || saveStatus !== 'idle') return;
    setSaveStatus('saving');
    try {
      await onSaveAsNote(message);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }

  return (
    <div
      className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/50 text-foreground',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.text}</p>
        ) : (
          <div className="space-y-2">
            {message.isWebSearch ? (
              <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <Sparkles className="h-3 w-3 shrink-0" />
                <span>此回答包含网络搜索结果</span>
              </div>
            ) : null}
            {message.text ? (
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                {message.text}
                {message.streaming ? (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-foreground/60" />
                ) : null}
              </p>
            ) : !message.streaming ? (
              <p className="text-muted-foreground">（无回答）</p>
            ) : null}
            {message.error ? (
              <p className="text-destructive">{message.error}</p>
            ) : null}
            {message.sources && message.sources.length > 0 ? (
              <details
                className="rounded-md border bg-background/50 p-2 text-xs"
                open={showSources}
                onToggle={(e) =>
                  setShowSources((e.target as HTMLDetailsElement).open)
                }
              >
                <summary className="flex cursor-pointer items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
                  {showSources ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  <Sparkles className="h-3 w-3" />
                  参考了 {message.sources.length} 篇笔记
                </summary>
                <ul className="mt-1 space-y-0.5 pl-5">
                  {message.sources.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`/notes/${s.id}`}
                        className="text-foreground/80 hover:text-foreground hover:underline"
                      >
                        {s.title || '（无标题）'}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {!message.streaming ? (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saveStatus !== 'idle'}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors',
                    saveStatus === 'saved'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : saveStatus === 'error'
                        ? 'text-destructive'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  )}
                >
                  <Save className="h-3 w-3" />
                  {saveStatus === 'saving'
                    ? '保存中…'
                    : saveStatus === 'saved'
                      ? '已保存为新笔记'
                      : saveStatus === 'error'
                        ? '保存失败'
                        : '保存为笔记'}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SSE consumer
// ---------------------------------------------------------------------------

type SseHandlers = {
  onSources: (sources: Source[], isWebSearch: boolean) => void;
  onDelta: (delta: string) => void;
  /** Called with the full accumulated assistant text when the stream completes. */
  onDone: (fullText: string) => void;
  onError: (msg: string) => void;
};

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  handlers: SseHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedSources = false;
  let streamClosedWithoutDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        streamClosedWithoutDone = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = raw
          .split('\n')
          .find((l) => l.startsWith('data: '));
        if (dataLine) {
          const json = dataLine.slice('data: '.length);
          try {
            const data = JSON.parse(json) as Record<string, unknown>;
            if (Array.isArray(data['sources']) && !receivedSources) {
              handlers.onSources(
                data['sources'] as Source[],
                data['isWebSearch'] === true,
              );
              receivedSources = true;
            } else if (typeof data['delta'] === 'string') {
              handlers.onDelta(data['delta'] as string);
            } else if (data['done'] === true) {
              const fullText =
                typeof data['fullText'] === 'string' ? data['fullText'] : '';
              handlers.onDone(fullText);
              return;
            } else if (typeof data['error'] === 'string') {
              handlers.onError(data['error'] as string);
              return;
            }
          } catch {
            // ignore malformed lines
          }
        }
        idx = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.cancel();
  }

  if (streamClosedWithoutDone) {
    handlers.onError('连接已中断，回答可能不完整');
  }
}
