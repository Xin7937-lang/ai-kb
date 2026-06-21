import type { WebSearchResult } from '../index';
import { getTavilyCount } from '../config';

export async function searchTavily(
  apiKey: string,
  query: string,
): Promise<WebSearchResult[]> {
  const maxResults = getTavilyCount();
  console.error(`[search] Tavily request: max_results=${maxResults}, query="${query}"`);
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const items = data.results || [];
  console.error(`[search] Tavily response: ${items.length} results`);
  return items.map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
  }));
}
