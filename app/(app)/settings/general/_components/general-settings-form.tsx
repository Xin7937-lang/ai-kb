'use client';

// /settings/general -- customizable app title and other general look-and-feel.
//
// Currently only the sidebar app title is user-editable. Add more cards
// here as the settings surface grows.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, BookOpen, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
// Keep these in sync with lib/auth/init.ts so the client bundle
// doesn't pull in the server-side DB module.
const CHAT_RETRIEVE_LIMIT_MIN = 1;
const CHAT_RETRIEVE_LIMIT_MAX = 20;
const CHAT_RETRIEVE_LIMIT_DEFAULT = 5;

type ApiOk = { ok: true };
type ApiErr = { error?: string; message?: string };

export function GeneralSettingsForm({
  initialTitle,
  initialChatRetrieveLimit,
  initialChatWebSearchEnabled,
}: {
  initialTitle: string;
  initialChatRetrieveLimit: number;
  initialChatWebSearchEnabled: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [chatRetrieveLimit, setChatRetrieveLimit] = useState(initialChatRetrieveLimit);
  const [chatWebSearch, setChatWebSearch] = useState(initialChatWebSearchEnabled);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        const [titleRes, limitRes, webSearchRes] = await Promise.all([
          fetch('/api/settings/app-title', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title.trim() }),
          }),
          fetch('/api/settings/chat-retrieve-limit', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: chatRetrieveLimit }),
          }),
          fetch('/api/settings/chat-web-search', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: chatWebSearch }),
          }),
        ]);
        const titleData = (await titleRes.json().catch(() => ({}))) as ApiOk & ApiErr;
        const limitData = (await limitRes.json().catch(() => ({}))) as ApiOk & ApiErr;
        const webSearchData = (await webSearchRes.json().catch(() => ({}))) as ApiOk & ApiErr;
        if (!titleRes.ok || !limitRes.ok || !webSearchRes.ok) {
          setError(
            titleData.message ??
              titleData.error ??
              limitData.message ??
              limitData.error ??
              webSearchData.message ??
              webSearchData.error ??
              '保存失败',
          );
          return;
        }
        setSuccess(true);
        // The sidebar reads the title server-side; revalidate to
        // pick up the new value on next render.
        router.refresh();
      } catch (err) {
        console.error('[general-settings] failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  const hasChanges =
    title !== initialTitle ||
    chatRetrieveLimit !== initialChatRetrieveLimit ||
    chatWebSearch !== initialChatWebSearchEnabled;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            界面外观
          </CardTitle>
          <CardDescription>
            自定义应用在浏览器标签、侧边栏、欢迎语里的显示。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">应用标题</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={32}
              placeholder="AI KB"
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              最多 32 个字符。留空则恢复默认「AI KB」。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" />
            与笔记对话
          </CardTitle>
          <CardDescription>
            调整 AI 在「与笔记对话」中每次检索参考的笔记数量。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chat-retrieve-limit">检索笔记数量</Label>
            <div className="flex items-center gap-3">
              <Input
                id="chat-retrieve-limit"
                type="number"
                min={CHAT_RETRIEVE_LIMIT_MIN}
                max={CHAT_RETRIEVE_LIMIT_MAX}
                value={chatRetrieveLimit}
                onChange={(e) => setChatRetrieveLimit(Number(e.target.value))}
                className="w-24"
                disabled={isPending}
              />
              <span className="text-sm text-muted-foreground">
                {CHAT_RETRIEVE_LIMIT_MIN} ~ {CHAT_RETRIEVE_LIMIT_MAX} 篇（默认 {CHAT_RETRIEVE_LIMIT_DEFAULT}）
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              数值越大，AI 参考的笔记越多，但会消耗更多 token 并可能稀释注意力。
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch
                id="chat-web-search"
                checked={chatWebSearch}
                onCheckedChange={setChatWebSearch}
                disabled={isPending}
              />
              <Label htmlFor="chat-web-search" className="cursor-pointer">
                启用外网搜索
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              开启后，AI 在回答时会同时调用外部搜索 API 获取网络结果作为参考。关闭时仅使用笔记内容和模型知识。
            </p>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
              已保存。
            </p>
          ) : null}

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isPending || !hasChanges}>
              {isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  保存中…
                </>
              ) : (
                '保存'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
