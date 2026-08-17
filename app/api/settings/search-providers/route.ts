// GET / PUT /api/settings/search-providers
//
// GET: list all search provider configs (key presence only, masked) + active provider + per-provider config params.
// PUT: update provider keys (encrypt at rest), active provider, and per-provider config params.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  listSearchProviders,
  getActiveSearchProvider,
  setSearchProviderKeyFromPlaintext,
  deleteSearchProviderKey,
  setActiveSearchProvider,
  setSearchProviderConfig,
  getAllProviderConfigs,
  type SearchProviderType,
} from '@/lib/search';

export const runtime = 'nodejs';

const PROVIDERS: SearchProviderType[] = ['tavily', 'metaso', 'bocha'];

const ProviderConfigFields = z.record(z.string(), z.string());

const PutBody = z.object({
  tavily: z.string().min(1).nullable().optional(),
  metaso: z.string().min(1).nullable().optional(),
  bocha: z.string().min(1).nullable().optional(),
  activeProvider: z.string().min(1).nullable().optional(),
  configs: z.record(z.string(), ProviderConfigFields).optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const providers = listSearchProviders();
  const active = getActiveSearchProvider();
  const configs = getAllProviderConfigs();
  return NextResponse.json({ data: { providers, activeProvider: active, configs } });
}

export async function PUT(request: NextRequest) {
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

  const parsed = PutBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: '请求格式错误' },
      { status: 400 },
    );
  }

  const data = parsed.data;

  for (const type of PROVIDERS) {
    const value = data[type];
    if (value === undefined) continue;
    if (value === null) {
      deleteSearchProviderKey(type);
    } else {
      setSearchProviderKeyFromPlaintext(type, value);
    }
  }

  if (data.activeProvider !== undefined) {
    const active = data.activeProvider;
    if (
      active === null ||
      active === 'tavily' ||
      active === 'metaso' ||
      active === 'bocha'
    ) {
      setActiveSearchProvider(active);
    }
  }

  if (data.configs) {
    for (const [type, params] of Object.entries(data.configs)) {
      if (!PROVIDERS.includes(type as SearchProviderType)) continue;
      for (const [param, value] of Object.entries(params)) {
        if (param === 'key') continue;
        setSearchProviderConfig(type as SearchProviderType, param, value);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
