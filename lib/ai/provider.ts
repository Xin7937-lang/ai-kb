// AI provider factory.
//
// Loads a `model_configs` row, decrypts its API key, and returns a configured
// `createOpenAI` client. Used by S8 (summarize) and `testModelConnection`.
//
// Compatible-mode: we set `compatibility: 'compatible'` so providers like
// DeepSeek / GLM / StepFun that don't speak the strict OpenAI protocol still
// work without complaining about stream options etc.

import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { getDb } from '@/lib/db/client';
import { decrypt } from '@/lib/crypto';
import { NoDefaultModelError, NoSuchModelError } from './errors';

type ModelConfigRow = {
  id: string;
  name: string;
  base_url: string;
  api_key_enc: string;
  model: string;
  is_default: number;
  created_at: number;
};

export type ResolvedModel = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

/**
 * Build a working OpenAI client from a stored model config id.
 * Throws `NoSuchModelError` if the id doesn't exist, or
 * `Error('Model key is corrupted')` if decryption fails (e.g. ENCRYPTION_KEY
 * changed since the row was written).
 */
export function getOpenAIClient(modelConfigId: string): OpenAIProvider {
  const resolved = loadResolvedModel(modelConfigId);
  return createOpenAI({
    baseURL: resolved.baseUrl,
    apiKey: resolved.apiKey,
    compatibility: 'compatible',
  });
}

/**
 * Same as `getOpenAIClient` but also returns the model id. Useful for
 * `streamText` / `generateText` callers that need both pieces.
 */
export function getModelAndClient(modelConfigId: string): {
  client: OpenAIProvider;
  modelId: string;
  modelConfigId: string;
  modelName: string;
} {
  const resolved = loadResolvedModel(modelConfigId);
  const client = createOpenAI({
    baseURL: resolved.baseUrl,
    apiKey: resolved.apiKey,
    compatibility: 'compatible',
  });
  return {
    client,
    modelId: resolved.model,
    modelConfigId: resolved.id,
    modelName: resolved.name,
  };
}

function loadResolvedModel(modelConfigId: string): ResolvedModel {
  const row = getDb()
    .prepare<[string], ModelConfigRow>(
      'SELECT id, name, base_url, api_key_enc, model, is_default, created_at ' +
        'FROM model_configs WHERE id = ?',
    )
    .get(modelConfigId);

  if (!row) {
    throw new NoSuchModelError(modelConfigId);
  }

  let apiKey: string;
  try {
    apiKey = decrypt(row.api_key_enc);
  } catch {
    throw new Error('Model key is corrupted');
  }

  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    apiKey,
  };
}


/**
 * Look up the id of the model_configs row whose \is_default = 1\.
 * Throws \NoDefaultModelError\ if no default is set. Both the summarize
 * (S8) and chat (RAG-lite) pipelines use this when no explicit modelId
 * override is provided.
 */
export function getDefaultModelId(): string {
  const row = getDb()
    .prepare<[], { id: string }>(
      "SELECT id FROM model_configs WHERE is_default = 1 AND kind = 'chat' LIMIT 1",
    )
    .get();
  if (!row) {
    throw new NoDefaultModelError();
  }
  return row.id;
}