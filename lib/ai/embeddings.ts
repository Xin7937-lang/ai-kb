// Embedding client + sqlite-vec extension loader.
//
// The sqlite-vec extension is loaded once at first access via
// `better-sqlite3`'s `loadExtension`. If loading fails (extension not
// installed for the platform, build mismatch, etc.) we set
// `embeddingEnabled = false` and the rest of the app degrades to
// FTS5-only retrieval. We never throw out of this module — callers
// check the flag and adapt.
//
// The `embedTexts` function is the only thing the write path and the
// retrieval path both call.

import { getLoadablePath } from 'sqlite-vec';

import { getDb } from '@/lib/db/client';
import { decrypt } from '@/lib/crypto';
import { NoDefaultEmbeddingModelError } from './errors';

const EMBEDDING_DIM = 2048;
const RRF_K = 60;

let _embeddingEnabled: boolean | null = null;
let _loadError: string | null = null;

/**
 * Try to load the sqlite-vec extension. Idempotent — first call does
 * the work, subsequent calls return the cached result.
 *
 * We try the well-known package names for sqlite-vec. The exact name
 * shipped depends on the platform; we attempt the most common ones.
 */
export function detectEmbeddingEnabled(): boolean {
  if (_embeddingEnabled !== null) return _embeddingEnabled;
  const db = getDb();
  const candidates = [
    getLoadablePath(),   // npm `sqlite-vec` package prebuilt binary (absolute path)
    'sqlite-vec',
    'sqlite_vec',
    'vec0',
  ];
  for (const name of candidates) {
    try {
      db.loadExtension(name);
      _embeddingEnabled = true;
      return true;
    } catch (err) {
      _loadError = (err as Error).message;
    }
  }
  _embeddingEnabled = false;
  return false;
}

export function isEmbeddingEnabled(): boolean {
  return _embeddingEnabled === true;
}

export function getEmbeddingLoadError(): string | null {
  return _loadError;
}

type ModelConfigRow = {
  id: string;
  base_url: string;
  api_key_enc: string;
  model: string;
};

/**
 * Look up the default embedding model config. Mirrors
 * `getDefaultModelId` in `provider.ts` but filters by `kind = 'embedding'`.
 */
export function getDefaultEmbeddingModelId(): string {
  const row = getDb()
    .prepare<[], { id: string }>(
      "SELECT id FROM model_configs WHERE is_default = 1 AND kind = 'embedding' LIMIT 1",
    )
    .get();
  if (!row) {
    throw new NoDefaultEmbeddingModelError();
  }
  return row.id;
}

function loadResolvedEmbeddingModel(modelConfigId: string) {
  const row = getDb()
    .prepare<[string], ModelConfigRow>(
      'SELECT id, base_url, api_key_enc, model FROM model_configs WHERE id = ?',
    )
    .get(modelConfigId);
  if (!row) {
    throw new NoDefaultEmbeddingModelError();
  }
  const apiKey = decrypt(row.api_key_enc);
  return { baseUrl: row.base_url, apiKey, model: row.model };
}

/**
 * Embed a batch of texts. Calls the OpenAI-compatible `/embeddings`
 * endpoint directly — we deliberately do not route through the Vercel
 * AI SDK because the SDK's `textEmbeddingModel` does not accept a
 * custom baseURL on 3.4.7, and we want one code path that works for
 * Qwen, OpenAI, GLM, and any other compatible endpoint.
 *
 * Throws on network / auth / parse errors. Callers in the write path
 * catch and degrade; callers in the retrieval path catch and skip
 * the embedding branch.
 */
export async function embedTexts(
  texts: string[],
  modelConfigId?: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const id = modelConfigId ?? getDefaultEmbeddingModelId();
  const { baseUrl, apiKey, model } = loadResolvedEmbeddingModel(id);

  // Zhipu's embedding API uses `dimensions` instead of OpenAI's
  // `encoding_format` — route to a dedicated handler when the baseUrl
  // points to the Zhipu endpoint.
  if (baseUrl.includes('bigmodel.cn')) {
    const { embedTextsZhipu } = await import('./embeddings-zhipu');
    return embedTextsZhipu(texts, apiKey, model, baseUrl);
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      encoding_format: 'float',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`embeddings HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vectors = data.data?.map((d) => d.embedding ?? []) ?? [];
  if (vectors.length !== texts.length) {
    throw new Error(
      `embeddings: expected ${texts.length} vectors, got ${vectors.length}`,
    );
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(
        `embeddings: expected dim ${EMBEDDING_DIM}, got ${v.length}. ` +
          `Did you configure the wrong embedding model?`,
      );
    }
  }
  return vectors;
}

export const EMBEDDING_DIMENSION = EMBEDDING_DIM;
export const RRF_K_VALUE = RRF_K;
