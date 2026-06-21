// Settings → Models → [id] — edit a model configuration.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDb } from '@/lib/db/client';
import { decrypt } from '@/lib/crypto';
import { toMaskedModelConfig } from '@/lib/ai/mask';
import { ModelForm } from '@/components/models/model-form';
import { TestConnectionButton } from '@/components/models/test-connection-button';
import { ModelActions } from '@/components/models/model-actions';

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

export default function EditModelPage({
  params,
}: {
  params: { id: string };
}) {
  const row = getDb()
    .prepare<[string], Row>(
      'SELECT id, name, base_url, api_key_enc, model, is_default, kind, created_at ' +
        'FROM model_configs WHERE id = ?',
    )
    .get(params.id);

  if (!row) {
    notFound();
  }

  let apiKey = '';
  try {
    apiKey = decrypt(row.api_key_enc);
  } catch {
    apiKey = '';
  }
  const masked = toMaskedModelConfig(row, apiKey);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/settings/models"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← 返回模型列表
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          编辑模型
          {masked.isDefault ? (
            <span className="ml-2 inline-flex items-center rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">
              默认
            </span>
          ) : null}
        </h1>
      </div>

      <ModelForm
        mode="edit"
        modelId={masked.id}
        initial={{
          name: masked.name,
          baseUrl: masked.baseUrl,
          model: masked.model,
          kind: masked.kind,
          isDefault: masked.isDefault,
          apiKeyMasked: masked.apiKeyMasked,
        }}
      />

      <div className="border-t pt-6 space-y-4">
        <div>
          <h2 className="text-sm font-medium">诊断</h2>
          <p className="text-xs text-muted-foreground">
            用当前配置发一次 1-token 的极短请求，验证凭据与网络。
          </p>
        </div>
        <TestConnectionButton modelId={masked.id} />
      </div>

      <div className="border-t pt-6 space-y-4">
        <div>
          <h2 className="text-sm font-medium">操作</h2>
        </div>
        <ModelActions modelId={masked.id} isDefault={masked.isDefault} />
      </div>
    </div>
  );
}
