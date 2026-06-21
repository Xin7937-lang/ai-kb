// POST /api/settings/search-providers/test
//
// Test a search provider API key by making a real search request.
// Body: { provider: 'tavily' | 'serper' | 'bing', apiKey?: string }
// If apiKey is provided, test that key; otherwise test the stored key.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  getDecryptedSearchApiKey,
  type SearchProviderType,
} from '@/lib/search';
import { searchTavily } from '@/lib/search/providers/tavily';
import { searchMetaso } from '@/lib/search/providers/metaso';
import { searchBocha } from '@/lib/search/providers/bocha';

export const runtime = 'nodejs';

const Body = z.object({
  provider: z.enum(['tavily', 'metaso', 'bocha']),
  apiKey: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: '请求格式错误' },
      { status: 400 },
    );
  }

  const { provider, apiKey: providedKey } = parsed.data;

  const apiKey = providedKey ?? getDecryptedSearchApiKey(provider);
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: '未配置 API Key' },
      { status: 400 },
    );
  }

  try {
    const testQuery = 'test';
    let results;
    switch (provider) {
      case 'tavily':
        results = await searchTavily(apiKey, testQuery);
        break;
      case 'metaso':
        results = await searchMetaso(apiKey, testQuery);
        break;
      case 'bocha':
        results = await searchBocha(apiKey, testQuery);
        break;
      default:
        return NextResponse.json(
          { ok: false, error: '未知的搜索服务' },
          { status: 400 },
        );
    }

    if (!results || results.length === 0) {
      return NextResponse.json(
        { ok: false, error: '搜索返回空结果，请检查 API Key 是否有效' },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[search-providers/test] ${provider} failed:`, err);
    const message = err instanceof Error ? err.message : '测试失败';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
