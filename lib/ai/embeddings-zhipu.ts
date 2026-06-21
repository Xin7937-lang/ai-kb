// Zhipu AI (智谱) embedding client.
//
// Calls the Zhipu embeddings API directly via fetch — we intentionally
// do NOT use the `zhipuai` SDK because it bundles JWT auth (key format
// dependent) and its types predate GLM Embedding-3 (no `dimensions`
// field, model union excludes `embedding-3`).
//
// Detection: callers should check that the model's baseUrl contains
// `bigmodel.cn` before routing here (see `embedTexts` in
// `lib/ai/embeddings.ts`).

import { EMBEDDING_DIMENSION } from './embeddings';

export async function embedTextsZhipu(
  texts: string[],
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const url = `${baseUrl.replace(/\/$/, '')}/embeddings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      dimensions: EMBEDDING_DIMENSION,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `zhipu embeddings HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vectors = data.data?.map((d) => d.embedding ?? []) ?? [];

  if (vectors.length !== texts.length) {
    throw new Error(
      `zhipu embeddings: expected ${texts.length} vectors, got ${vectors.length}`,
    );
  }
  for (let i = 0; i < vectors.length; i++) {
    if (vectors[i].length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `zhipu embeddings: vector[${i}] has dim ${vectors[i].length}, ` +
          `expected ${EMBEDDING_DIMENSION}. Did you configure the wrong embedding model?`,
      );
    }
  }
  return vectors;
}
