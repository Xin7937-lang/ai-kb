import type { WebSearchResult } from '../index';
import { getBochaCount } from '../config';

export async function searchBocha(
  apiKey: string,
  query: string,
): Promise<WebSearchResult[]> {
  const count = getBochaCount();
  console.error(`[search] Bocha request: count=${count}, query="${query}"`);
  const res = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      summary: true,
      freshness: 'noLimit',
      count,
    }),
  });
  if (!res.ok) {
    throw new Error(`Bocha search failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    data?: {
      webPages?: {
        value?: Array<{
          name?: string;
          url?: string;
          summary?: string;
          snippet?: string;
        }>;
      };
    };
  };
  const items = data.data?.webPages?.value || [];
  console.error(`[search] Bocha response: ${items.length} results`);
  return items.map((r) => ({
    title: r.name || '',
    url: r.url || '',
    snippet: r.summary || r.snippet || '',
  }));
}
