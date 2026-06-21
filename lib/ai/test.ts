// Lightweight "does this model config actually work?" probe used by the
// /api/models/:id/test endpoint.
//
// For chat models: issues a 1-token chat completion request with a 10s
// timeout.
// For embedding models: calls the embeddings API with a single test input.
//
// Never throws — returns { ok, error? } so the API caller can render the
// result inline.

import { generateText } from 'ai';
import { getModelAndClient } from './provider';
import { getDb } from '@/lib/db/client';
import { NoSuchModelError } from './errors';

export type TestConnectionResult = {
  ok: boolean;
  error?: string;
};

const TEST_TIMEOUT_MS = 10_000;

export async function testModelConnection(
  modelConfigId: string,
): Promise<TestConnectionResult> {
  // Determine whether this is a chat or embedding model.
  const row = getDb()
    .prepare<[string], { kind: string }>(
      'SELECT kind FROM model_configs WHERE id = ?',
    )
    .get(modelConfigId);

  if (!row) {
    return { ok: false, error: '模型配置不存在' };
  }

  if (row.kind === 'embedding') {
    return testEmbeddingModel(modelConfigId);
  }
  return testChatModel(modelConfigId);
}

async function testChatModel(
  modelConfigId: string,
): Promise<TestConnectionResult> {
  let modelId: string;
  let chatModel: ReturnType<ReturnType<typeof getModelAndClient>['client']['chat']>;
  try {
    const { client, modelId: id } = getModelAndClient(modelConfigId);
    modelId = id;
    chatModel = client.chat(id);
  } catch (err) {
    if (err instanceof NoSuchModelError) {
      return { ok: false, error: '模型配置不存在' };
    }
    return { ok: false, error: errorMessage(err) };
  }

  try {
    await generateText({
      model: chatModel,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 1,
      abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function testEmbeddingModel(
  modelConfigId: string,
): Promise<TestConnectionResult> {
  try {
    // Dynamic import to avoid loading embedding infra for chat-only
    // deployments at module-init time.
    const { embedTexts } = await import('./embeddings');
    await embedTexts(['connection test'], modelConfigId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  return String(err);
}
