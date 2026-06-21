import {
  getActiveSearchProvider,
  getDecryptedSearchApiKey,
  type SearchProviderType,
} from './config';
import { searchTavily } from './providers/tavily';
import { searchMetaso } from './providers/metaso';
import { searchBocha } from './providers/bocha';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchWeb(
  query: string,
): Promise<WebSearchResult[] | null> {
  const active = getActiveSearchProvider();
  if (!active) return null;

  const apiKey = getDecryptedSearchApiKey(active);
  if (!apiKey) return null;

  try {
    let results: WebSearchResult[] | null = null;
    switch (active) {
      case 'tavily':
        results = await searchTavily(apiKey, query);
        break;
      case 'metaso':
        results = await searchMetaso(apiKey, query);
        break;
      case 'bocha':
        results = await searchBocha(apiKey, query);
        break;
      default:
        return null;
    }
    console.error(`[searchWeb] ${active} final: ${results?.length ?? 0} results`);
    return results;
  } catch (err) {
    console.error(`[searchWeb] ${active} failed:`, err);
    return null;
  }
}

export type { SearchProviderType };
export {
  getActiveSearchProvider,
  getDecryptedSearchApiKey,
  setSearchProviderKeyFromPlaintext,
  deleteSearchProviderKey,
  setActiveSearchProvider,
  listSearchProviders,
  maskApiKey,
  PROVIDER_META,
  getSearchProviderConfig,
  setSearchProviderConfig,
  deleteSearchProviderConfig,
  getAllProviderConfigs,
} from './config';
