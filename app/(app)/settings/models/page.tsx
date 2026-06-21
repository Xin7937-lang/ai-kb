// Settings → Models — list of all configured AI models with the API key
// masked. Empty state points the user at the "New Model" button.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getDb } from '@/lib/db/client';
import { decrypt } from '@/lib/crypto';
import { ModelListItem } from '@/components/models/model-list-item';
import { toMaskedModelConfig } from '@/lib/ai/mask';

export const dynamic = 'force-dynamic';

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

export default function ModelsListPage() {
  const rows = getDb()
    .prepare<[], Row>(
      'SELECT id, name, base_url, api_key_enc, model, is_default, kind, created_at ' +
        'FROM model_configs ORDER BY is_default DESC, created_at DESC',
    )
    .all();

  const items = rows.map((row) => {
    let apiKey = '';
    try {
      apiKey = decrypt(row.api_key_enc);
    } catch {
      apiKey = '';
    }
    return toMaskedModelConfig(row, apiKey);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AI 模型</h1>
          <p className="text-sm text-muted-foreground">
            管理用于 AI 摘要的模型配置。可同时配置多个，凭 API Key 区分。
          </p>
        </div>
        <Button asChild>
          <Link href="/settings/models/new">+ 新建模型</Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <h2 className="text-lg font-medium">还没有模型</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            添加一个以启用 AI 摘要。
          </p>
          <div className="mt-4">
            <Button asChild>
              <Link href="/settings/models/new">+ 新建模型</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((m) => (
            <ModelListItem
              key={m.id}
              model={{
                id: m.id,
                name: m.name,
                baseUrl: m.baseUrl,
                model: m.model,
                kind: m.kind,
                isDefault: m.isDefault,
                createdAt: m.createdAt,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
