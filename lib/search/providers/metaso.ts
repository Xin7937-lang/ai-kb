import type { WebSearchResult } from '../index';
import {
  getMetasoScope,
  getMetasoSize,
  getMetasoConciseSnippet,
  getMetasoIncludeSummary,
} from '../config';

export async function searchMetaso(
  apiKey: string,
  query: string,
): Promise<WebSearchResult[]> {
  const scope = getMetasoScope();
  const size = getMetasoSize();
  const conciseSnippet = getMetasoConciseSnippet();
  const includeSummary = getMetasoIncludeSummary();

  console.error(`[search] Metaso request: size=${size}, scope=${scope}, query="${query}"`);
  const res = await fetch('https://metaso.cn/api/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      scope,
      includeSummary,
      size,
      includeRawContent: false,
      conciseSnippet,
    }),
  });
  if (!res.ok) {
    throw new Error(`Metaso search failed: ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  console.error(`[search] Metaso raw response keys:`, Object.keys(data));

  // API error response
  if (data.code === 5000 || data.errCode === 4000) {
    console.error(`[search] Metaso API error: code=${data.code}, errCode=${data.errCode}`);
    return [];
  }

  // Different scopes return results under different keys
  const items: Array<Record<string, string>> =
    (data.webpages as Array<Record<string, string>> | undefined) ??
    (data.images as Array<Record<string, string>> | undefined) ??
    [];

  console.error(`[search] Metaso response: ${items.length} results (scope=${scope})`);
  return (items || []).map((r) => ({
    title: r.title || '',
    url: r.link || r.imageUrl || '',
    // 图片结果没有 snippet，将 URL 填充进去让 AI 能看到
    snippet: r.snippet || r.imageUrl || '',
  }));
}
