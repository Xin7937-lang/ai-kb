'use client';

// /settings/agent — API Token card (ticket 11). Lets the user generate,
// rotate, or clear the bearer token used by LAN agents to authenticate
// without a JWT cookie.
//
// The raw token is shown exactly once: immediately after PUT, the
// response contains it and we render it with a copy button + a clear
// warning. The next page load (or any reload) re-fetches GET and sees
// only `{ configured, createdAt }` — the raw form is gone from the
// server.

import { useState } from 'react';
import { Check, Copy, KeyRound, Loader2, RotateCw, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type ApiTokenStatus = {
  configured: boolean;
  createdAt: number | null;
};

export function AgentApiTokenCard({
  initialStatus,
}: {
  initialStatus: ApiTokenStatus;
}) {
  const [status, setStatus] = useState<ApiTokenStatus>(initialStatus);
  // The raw token, captured from the PUT response. Rendered with a
  // warning banner and a copy button. null after the user dismisses it
  // or navigates away.
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<'idle' | 'generating' | 'clearing'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [copied, setCopied] = useState(false);

  async function loadStatus() {
    try {
      const res = await fetch('/api/settings/agent-api-token');
      const json = (await res.json().catch(() => ({}))) as {
        data?: ApiTokenStatus;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.data) {
        setError(json.message ?? json.error ?? '读取状态失败');
        return;
      }
      setStatus(json.data);
    } catch (err) {
      console.error('[agent-api-token] status fetch failed:', err);
      setError('网络错误，请重试');
    }
  }

  async function generate() {
    setBusy('generating');
    setError(null);
    setRevealedToken(null);
    setConfirmRotate(false);
    try {
      const res = await fetch('/api/settings/agent-api-token', {
        method: 'PUT',
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { token: string; createdAt: number };
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.data) {
        setError(json.message ?? json.error ?? '生成失败');
        setBusy('idle');
        return;
      }
      setRevealedToken(json.data.token);
      setStatus({ configured: true, createdAt: json.data.createdAt });
      setBusy('idle');
    } catch (err) {
      console.error('[agent-api-token] generate failed:', err);
      setError('网络错误，请重试');
      setBusy('idle');
    }
  }

  async function clear() {
    setBusy('clearing');
    setError(null);
    setConfirmClear(false);
    try {
      const res = await fetch('/api/settings/agent-api-token', {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setError(json.message ?? json.error ?? '清除失败');
        setBusy('idle');
        return;
      }
      setRevealedToken(null);
      setStatus({ configured: false, createdAt: null });
      setBusy('idle');
    } catch (err) {
      console.error('[agent-api-token] clear failed:', err);
      setError('网络错误，请重试');
      setBusy('idle');
    }
  }

  async function copyToken() {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('[agent-api-token] copy failed:', err);
    }
  }

  function dismissRevealed() {
    setRevealedToken(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          局域网 Agent 访问令牌
        </CardTitle>
        <CardDescription>
          同一局域网内的 agent（其他 Claude Code 实例、CLI 脚本、HTTP 客户端）可以用这个
          Bearer Token 访问 API，无需登录或管理 cookie。Token 只在生成时显示一次。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {revealedToken ? (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              立即复制 Token — 这是唯一显示的机会，关闭后无法再查看。
            </p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs"
                data-testid="api-token-value"
              >
                {revealedToken}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={copyToken}
                aria-label="复制 token"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={dismissRevealed}>
              我已复制，关闭提示
            </Button>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {status.configured && status.createdAt ? (
          <p className="text-xs text-muted-foreground">
            当前 Token 生成于 {new Date(status.createdAt).toLocaleString('zh-CN')}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            当前未配置 Token — 局域网 agent 无法访问 API。
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!status.configured ? (
            <Button
              onClick={generate}
              disabled={busy !== 'idle'}
              data-testid="generate-token"
            >
              {busy === 'generating' ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : null}
              生成 Token
            </Button>
          ) : (
            <>
              {confirmRotate ? (
                <>
                  <Button
                    onClick={generate}
                    disabled={busy !== 'idle'}
                    data-testid="confirm-rotate"
                  >
                    {busy === 'generating' ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCw className="mr-2 h-3.5 w-3.5" />
                    )}
                    确认重新生成（旧 Token 立即失效）
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmRotate(false)}
                    disabled={busy !== 'idle'}
                  >
                    取消
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setConfirmRotate(true)}
                  disabled={busy !== 'idle'}
                  data-testid="rotate-token"
                >
                  <RotateCw className="mr-2 h-3.5 w-3.5" />
                  重新生成
                </Button>
              )}

              {confirmClear ? (
                <>
                  <Button
                    variant="destructive"
                    onClick={clear}
                    disabled={busy !== 'idle'}
                    data-testid="confirm-clear"
                  >
                    {busy === 'clearing' ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                    )}
                    确认清除
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmClear(false)}
                    disabled={busy !== 'idle'}
                  >
                    取消
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setConfirmClear(true)}
                  disabled={busy !== 'idle'}
                  data-testid="clear-token"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  清除
                </Button>
              )}
            </>
          )}
        </div>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">用法示例</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono">
{`curl -H 'Authorization: Bearer <token>' \\
  http://nas-ip:3000/api/notes

# 聊天（含 SSE）：
curl -N -H 'Authorization: Bearer <token>' \\
  -H 'Content-Type: application/json' \\
  -X POST http://nas-ip:3000/api/chat \\
  -d '{"messages":[{"role":"user","content":"..."}]}'`}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}
