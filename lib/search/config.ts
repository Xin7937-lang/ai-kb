// Search provider configuration — stored in the settings KV table.
// API keys are AES-256-GCM encrypted at rest (same scheme as model_configs).

import { encrypt, decrypt } from '../crypto';
import { getDb } from '../db/client';

export type SearchProviderType = 'tavily' | 'metaso' | 'bocha';

export const PROVIDER_META: Record<
  SearchProviderType,
  { name: string; placeholder: string }
> = {
  tavily: { name: 'Tavily', placeholder: 'tvly-...' },
  metaso: { name: '秘塔搜索', placeholder: 'mk-...' },
  bocha: { name: '博查', placeholder: 'BOCHA-...' },
};

const ACTIVE_PROVIDER_KEY = 'search_active_provider';

function settingsKey(type: SearchProviderType): string {
  return `search_provider_${type}_key`;
}

export function getSearchProviderKey(type: SearchProviderType): string | null {
  const row = getDb()
    .prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    )
    .get(settingsKey(type));
  return row?.value ?? null;
}

export function setSearchProviderKey(
  type: SearchProviderType,
  encryptedKey: string,
): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(settingsKey(type), encryptedKey);
}

export function deleteSearchProviderKey(type: SearchProviderType): void {
  getDb()
    .prepare('DELETE FROM settings WHERE key = ?')
    .run(settingsKey(type));
}

export function getDecryptedSearchApiKey(
  type: SearchProviderType,
): string | null {
  const encrypted = getSearchProviderKey(type);
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    console.error(`[search] failed to decrypt ${type} api key`);
    return null;
  }
}

export function setSearchProviderKeyFromPlaintext(
  type: SearchProviderType,
  apiKey: string,
): void {
  const encrypted = encrypt(apiKey.trim());
  setSearchProviderKey(type, encrypted);
}

export function getActiveSearchProvider(): SearchProviderType | null {
  const raw = getDb()
    .prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    )
    .get(ACTIVE_PROVIDER_KEY)?.value;
  if (!raw) return null;
  if (raw === 'tavily' || raw === 'metaso' || raw === 'bocha') return raw;
  return null;
}

export function setActiveSearchProvider(
  type: SearchProviderType | null,
): void {
  if (!type) {
    getDb()
      .prepare('DELETE FROM settings WHERE key = ?')
      .run(ACTIVE_PROVIDER_KEY);
    return;
  }
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(ACTIVE_PROVIDER_KEY, type);
}

export function listSearchProviders(): Array<{
  type: SearchProviderType;
  name: string;
  hasKey: boolean;
}> {
  return (Object.keys(PROVIDER_META) as SearchProviderType[]).map((type) => ({
    type,
    name: PROVIDER_META[type].name,
    hasKey: getSearchProviderKey(type) !== null,
  }));
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// ── Provider config params ──────────────────────────────────────

/** Generic getter for a provider param stored in the settings KV table. */
export function getSearchProviderConfig(
  type: SearchProviderType,
  param: string,
  defaultValue: string,
): string {
  const row = getDb()
    .prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    )
    .get(`search_provider_${type}_${param}`);
  return row?.value ?? defaultValue;
}

/** Generic setter for a provider param. */
export function setSearchProviderConfig(
  type: SearchProviderType,
  param: string,
  value: string,
): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(`search_provider_${type}_${param}`, value);
}

/** Delete a provider param (reset to default). */
export function deleteSearchProviderConfig(
  type: SearchProviderType,
  param: string,
): void {
  getDb()
    .prepare('DELETE FROM settings WHERE key = ?')
    .run(`search_provider_${type}_${param}`);
}

/** Read all stored configs for every provider. */
export function getAllProviderConfigs(): Record<string, Record<string, string>> {
  const rows = getDb()
    .prepare<[], { key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key LIKE 'search_provider_%_%'",
    )
    .all();
  const result: Record<string, Record<string, string>> = {};
  for (const { key, value } of rows) {
    const parts = key.split('_');
    if (parts.length < 4) continue;
    const type = parts[2];
    const param = parts.slice(3).join('_');
    if (!result[type]) result[type] = {};
    result[type][param] = value;
  }
  return result;
}

// ── Typed param helpers ─────────────────────────────────────────

export function getTavilyCount(): number {
  return parseInt(getSearchProviderConfig('tavily', 'count', '5'), 10) || 5;
}

export function getMetasoScope(): string {
  return getSearchProviderConfig('metaso', 'scope', 'webpage');
}

export function getMetasoSize(): number {
  return parseInt(getSearchProviderConfig('metaso', 'size', '10'), 10) || 10;
}

export function getMetasoConciseSnippet(): boolean {
  return getSearchProviderConfig('metaso', 'conciseSnippet', 'false') === 'true';
}

export function getMetasoIncludeSummary(): boolean {
  return getSearchProviderConfig('metaso', 'includeSummary', 'true') === 'true';
}

export function getBochaCount(): number {
  return parseInt(getSearchProviderConfig('bocha', 'count', '10'), 10) || 10;
}
