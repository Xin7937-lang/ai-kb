// /api/models/[id] — read, update, delete a single model configuration.
//
// GET    → returns the row with the API key masked.
// PUT    → partial update. apiKey: empty string or undefined keeps the
//          existing encrypted value. isDefault: true atomically demotes all
//          other rows of the same kind and promotes this one; false clears
//          this row's flag.
// DELETE → removes the row. The unique partial default index means the
//          caller can simply delete without worrying about orphans.

import { NextResponse, type NextRequest } from 'next/server';
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

const UpdateBody = z.object({
  name: z.string().min(1).max(64).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().max(512).optional(),
  model: z.string().min(1).max(128).optional(),
  kind: z.enum(['chat', 'embedding']).optional(),
  isDefault: z.boolean().optional(),
});

function loadRow(id: string): Row | undefined {
  return getDb()
    .prepare<[string], Row>(
      'SELECT id, name, base_url, api_key_enc, model, is_default, kind, created_at ' +
        'FROM model_configs WHERE id = ?',
    )
    .get(id);
}

function rowToMasked(row: Row): MaskedModelConfig {
  let apiKey = '';
  try {
    apiKey = decrypt(row.api_key_enc);
  } catch {
    apiKey = '';
  }
  return toMaskedModelConfig(row, apiKey);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const row = loadRow(params.id);
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ data: rowToMasked(row) });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const existing = loadRow(params.id);
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const { name, baseUrl, apiKey, model, isDefault } = parsed.data;
  const trimmedApiKey = apiKey?.trim() ?? '';
  const newApiKeyEnc =
    trimmedApiKey.length > 0 ? encrypt(trimmedApiKey) : existing.api_key_enc;

  // Build the dynamic SET clause for the non-default fields.
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (name !== undefined) {
    sets.push('name = ?');
    args.push(name);
  }
  if (baseUrl !== undefined) {
    sets.push('base_url = ?');
    args.push(baseUrl);
  }
  if (trimmedApiKey.length > 0) {
    sets.push('api_key_enc = ?');
    args.push(newApiKeyEnc);
  }
  if (model !== undefined) {
    sets.push('model = ?');
    args.push(model);
  }
  if (parsed.data.kind !== undefined) {
    sets.push('kind = ?');
    args.push(parsed.data.kind);
  }

  try {
    if (isDefault === true) {
      // Atomically: all rows of the same kind off, this row on.
      const targetKind = parsed.data.kind ?? existing.kind;
      tx((db) => {
        db.prepare('UPDATE model_configs SET is_default = 0 WHERE kind = ?').run(targetKind);
        if (sets.length > 0) {
          db.prepare(
            `UPDATE model_configs SET ${sets.join(', ')} WHERE id = ?`,
          ).run(...args, params.id);
        }
        db.prepare('UPDATE model_configs SET is_default = 1 WHERE id = ?').run(
          params.id,
        );
      });
    } else {
      if (isDefault === false) {
        sets.push('is_default = 0');
      }
      if (sets.length > 0) {
        getDb()
          .prepare(
            `UPDATE model_configs SET ${sets.join(', ')} WHERE id = ?`,
          )
          .run(...args, params.id);
      }
    }
  } catch (err) {
    console.error('[models.PUT] update failed:', err);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  const updated = loadRow(params.id);
  if (!updated) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ data: rowToMasked(updated) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const existing = loadRow(params.id);
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    getDb().prepare('DELETE FROM model_configs WHERE id = ?').run(params.id);
  } catch (err) {
    console.error('[models.DELETE] failed:', err);
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
