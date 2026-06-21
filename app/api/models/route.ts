// /api/models — list and create model configurations.
//
// GET  → returns all configs with the API key masked (last 4 chars).
// POST → validates body, encrypts api_key, inserts a new row, returns the
//        masked config.

import { NextResponse, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb, tx } from '@/lib/db/client';
import { encrypt, decrypt } from '@/lib/crypto';
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

const CreateBody = z.object({
  name: z.string().min(1).max(64),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).max(512),
  model: z.string().min(1).max(128),
  kind: z.enum(['chat', 'embedding']).optional().default('chat'),
  isDefault: z.boolean().optional().default(false),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rows = getDb()
    .prepare<[], Row>(
      'SELECT id, name, base_url, api_key_enc, model, is_default, kind, created_at ' +
        'FROM model_configs ORDER BY created_at DESC',
    )
    .all();

  const data: MaskedModelConfig[] = rows.map((row) => {
    let apiKey = '';
    try {
      apiKey = decrypt(row.api_key_enc);
    } catch {
      // Corrupted key — surface a placeholder so the UI can still show the row.
      apiKey = '';
    }
    return toMaskedModelConfig(row, apiKey);
  });

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const { name, baseUrl, apiKey, model, isDefault } = parsed.data;
  const id = nanoid(12);
  const apiKeyEnc = encrypt(apiKey);
  const now = Date.now();

  try {
    if (isDefault) {
      tx((db) => {
        db.prepare('UPDATE model_configs SET is_default = 0 WHERE kind = ?').run(parsed.data.kind);
        db.prepare(
          'INSERT INTO model_configs (id, name, base_url, api_key_enc, model, kind, is_default, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
        ).run(id, name, baseUrl, apiKeyEnc, model, parsed.data.kind, now);
      });
    } else {
      getDb()
        .prepare(
          'INSERT INTO model_configs (id, name, base_url, api_key_enc, model, kind, is_default, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
        )
        .run(id, name, baseUrl, apiKeyEnc, model, parsed.data.kind, now);
    }
  } catch (err) {
    console.error('[models.POST] insert failed:', err);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  const row: Row = {
    id,
    name,
    base_url: baseUrl,
    api_key_enc: apiKeyEnc,
    model,
    is_default: isDefault ? 1 : 0,
    kind: parsed.data.kind,
    created_at: now,
  };
  return NextResponse.json({ data: toMaskedModelConfig(row, apiKey) }, { status: 201 });
}
