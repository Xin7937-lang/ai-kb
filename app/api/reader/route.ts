// POST /api/reader — fetch a web page via 秘塔 reader API and return
//                Markdown content + TipTap JSON for one-click note saving.
//
// Requires 秘塔 API key to be configured in search provider settings.
// The markdown is converted to a TipTap JSON document server-side so the
// client can pass it straight to POST /api/notes.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { getDecryptedSearchApiKey } from '@/lib/search/config';
import { markdownToTiptap } from '@/lib/notes/markdown';

export const runtime = 'nodejs';

const ReaderBody = z.object({
  url: z.string().url().max(2000),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = getDecryptedSearchApiKey('metaso');
  if (!apiKey) {
    return NextResponse.json(
      { error: 'metaso_api_key_not_configured', message: '请先在设置中配置秘塔搜索 API Key' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = ReaderBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { url } = parsed.data;

  try {
    const res = await fetch('https://metaso.cn/api/v1/reader', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/plain',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown error');
      return NextResponse.json(
        { error: 'reader_api_error', message: `秘塔 reader 返回 ${res.status}: ${errText.slice(0, 500)}` },
        { status: 502 },
      );
    }

    const markdown = await res.text();

    // Try to extract title from response headers
    let title = '';
    const sourceTitle = res.headers.get('X-Source-Title');
    const sourceUrl = res.headers.get('X-Source-Url');
    if (sourceTitle) {
      try {
        title = decodeURIComponent(sourceTitle);
      } catch {
        title = sourceTitle;
      }
    }
    if (!title) {
      // Fall back to the URL hostname as a rough title
      try {
        const u = new URL(url);
        title = u.hostname;
      } catch {
        title = url;
      }
    }

    // Convert markdown to TipTap JSON for note creation
    const { contentJson: tiptapDoc, contentText } = markdownToTiptap(markdown);

    return NextResponse.json({
      data: {
        title,
        url,
        markdown,
        tiptapDoc,
        contentText,
      },
    });
  } catch (err) {
    console.error('[reader] fetch failed:', err);
    return NextResponse.json(
      {
        error: 'reader_fetch_failed',
        message: err instanceof Error ? err.message : '请求秘塔 reader 失败',
      },
      { status: 502 },
    );
  }
}
