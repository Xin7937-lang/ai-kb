// /api/models/default — GET the row whose is_default = 1.
//
// Used by S8 (AI summarize) which calls the `getDefaultOpenAIClient` factory
// inside the same request. This HTTP route is here so any client-side code
// (and tests) can resolve the default without hitting the DB directly.

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { decrypt } from '@/lib/crypto';
import { getSession } from '@/lib/auth/session';
import { toMaskedModelConfig, type MaskedModelConfig } from '@/lib/ai/mask';

export const runtime = 'nodejs';

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

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const row = getDb()
    .prepare<[], Row>(
      'SELECT id, name, base_url, api_key_enc, model, is_default, kind, created_at ' +
        'FROM model_configs WHERE is_default = 1 AND kind = \'chat\' LIMIT 1',
    )
    .get();

  if (!row) {
    return NextResponse.json(
      { error: 'no_default_model', message: '没有设置默认模型' },
      { status: 404 },
    );
  }

  let apiKey = '';
  try {
    apiKey = decrypt(row.api_key_enc);
  } catch {
    apiKey = '';
  }
  const data: MaskedModelConfig = toMaskedModelConfig(row, apiKey);
  return NextResponse.json({ data });
}
