'use client';

// /reader — fetch a web page via 秘塔 reader and optionally save as a note.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Loader2, BookmarkPlus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type ReaderData = {
  title: string;
  url: string;
  markdown: string;
  tiptapDoc: unknown;
  contentText: string;
};

export default function ReaderPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReaderData | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleFetch() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('请输入网址');
      return;
    }

    // Basic URL normalization: prepend https:// if missing
    let normalized = trimmed;
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = 'https://' + normalized;
    }

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch('/api/reader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });
      interface ReaderResponse {
        data?: ReaderData;
        error?: string;
        message?: string;
      }
      const json = (await res.json()) as ReaderResponse;

      if (!res.ok || json.error) {
        setError(json.message ?? json.error ?? '读取失败');
        return;
      }

      if (!json.data) {
        setError('读取结果为空');
        return;
      }

      setData(json.data);
    } catch (err) {
      console.error('[reader] fetch error:', err);
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!data) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title || '未命名笔记',
          contentJson: data.tiptapDoc,
          contentText: data.contentText,
          tags: ['输入'],
        }),
      });
      const json = (await res.json()) as { data?: { id: string }; error?: string; message?: string };
      if (!res.ok || !json.data) {
        setError(json.message ?? json.error ?? '保存失败');
        return;
      }
      router.push(`/notes/${json.data.id}`);
      router.refresh();
    } catch (err) {
      console.error('[reader] save error:', err);
      setError('网络错误，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Globe className="h-5 w-5" />
          网页读取
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          输入网页地址，通过秘塔 reader 获取全文内容，并可一键转存为笔记。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">输入网址</CardTitle>
          <CardDescription>
            支持任意公开可访问的网页地址
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input
              type="url"
              placeholder="https://example.com/article"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) handleFetch();
              }}
              disabled={loading}
              className="flex-1"
            />
            <Button onClick={handleFetch} disabled={loading || !url.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  读取中…
                </>
              ) : (
                '读取'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {data.title || '（无标题）'}
            </CardTitle>
            <CardDescription className="flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />
              <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground transition-colors truncate"
              >
                {data.url}
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <pre className="max-h-[60vh] overflow-y-auto rounded border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
              {data.markdown}
            </pre>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  保存中…
                </>
              ) : (
                <>
                  <BookmarkPlus className="mr-1 h-4 w-4" />
                  转存笔记
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
