// Convert a `model_configs` DB row + decrypted API key into the public
// shape returned by the API. Never exposes the raw `api_key_enc`; only a
// short last-4 preview.

type Row = {
  id: string;
  name: string;
  base_url: string;
  api_key_enc: string;
  model: string;
  is_default: number;
  kind: 'chat' | 'embedding';
  created_at: number;
};

export type MaskedModelConfig = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  kind: 'chat' | 'embedding';
  isDefault: boolean;
  createdAt: number;
  apiKeyMasked: string;
};

export function toMaskedModelConfig(
  row: Row,
  decryptedApiKey: string,
): MaskedModelConfig {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    kind: row.kind,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    apiKeyMasked: maskKey(decryptedApiKey),
  };
}

/**
 * Returns "sk-***" plus the last 4 characters of the key, e.g. "sk-***abcd".
 * Falls back to "sk-***" for keys shorter than 4 chars.
 */
export function maskKey(apiKey: string): string {
  const tail = apiKey.length >= 4 ? apiKey.slice(-4) : apiKey;
  return `sk-***${tail}`;
}
