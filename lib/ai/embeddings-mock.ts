// lib/ai/embeddings-mock.ts
//
// Mock embedder for unit tests. Mirrors the public signature of
// `embedTexts` in lib/ai/embeddings.ts so tests can swap it in
// without hitting the real Zhipu endpoint.
//
// Vectors are deterministic per-text. Each position in a 2048-dim
// vector is hashed independently (`text + ':' + index`) so cosine
// similarity between two vectors is meaningful (not all-equal per
// vector, which would give cosine = 1.0 between any two texts).
// Force-failure mode (env EMBEDDING_MOCK_FORCE_FAIL=1) lets tests
// exercise the embedding-disabled fallback path.

const MOCK_DIM = 2048;

function hashString(s: string): number {
  // djb2 string hash → 32-bit unsigned integer
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export async function mockEmbedTexts(
  texts: string[],
  // Accepted for signature parity with the real `embedTexts`; the
  // mock ignores it (same text always yields the same vector).
  modelConfigId?: string,
): Promise<number[][]> {
  if (process.env.EMBEDDING_MOCK_FORCE_FAIL === '1') {
    throw new Error(
      'mockEmbedTexts: forced failure (set EMBEDDING_MOCK_FORCE_FAIL=1)',
    );
  }
  if (texts.length === 0) return [];
  return texts.map((t) =>
    Array.from({ length: MOCK_DIM }, (_, i) => hashString(`${t}:${i}`)),
  );
}