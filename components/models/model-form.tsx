'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ModelFormInitial = {
  name: string;
  baseUrl: string;
  model: string;
  kind: 'chat' | 'embedding';
  isDefault: boolean;
  apiKeyMasked: string;
};

type PresetId = '' | 'deepseek' | 'minimax' | 'glm' | 'stepfun' | 'custom';

type Preset = {
  id: Exclude<PresetId, '' | 'custom'>;
  label: string;
  name: string;
  baseUrl?: string;
  model?: string;
};

const PRESETS: Preset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    name: 'MiniMax',
    // No preset URL/model — user fills in.
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4',
  },
  {
    id: 'stepfun',
    label: '阶跃 StepFun',
    name: '阶跃 StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    model: 'step-1-8k',
  },
];

type Props = {
  mode: 'create' | 'edit';
  modelId?: string;
  initial?: ModelFormInitial;
  onSavedRedirect?: string; // for create: defaults to /settings/models/<id>
};

export function ModelForm({ mode, modelId, initial, onSavedRedirect }: Props) {
  const router = useRouter();
  const [preset, setPreset] = useState<PresetId>('');
  const [name, setName] = useState(initial?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(initial?.model ?? '');
  const [kind, setKind] = useState<'chat' | 'embedding'>(initial?.kind ?? 'chat');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function applyPreset(next: PresetId) {
    setPreset(next);
    if (next === '' || next === 'custom') return;
    const p = PRESETS.find((x) => x.id === next);
    if (!p) return;
    if (!name.trim()) setName(p.name);
    if (p.baseUrl !== undefined) setBaseUrl(p.baseUrl);
    if (p.model !== undefined) setModel(p.model);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedKey = apiKey.trim();
    if (mode === 'create' && trimmedKey.length === 0) {
      setError('请填写 API Key');
      return;
    }
    if (trimmedKey.length > 512) {
      setError('API Key 过长');
      return;
    }

    const url = mode === 'create' ? '/api/models' : `/api/models/${modelId}`;
    const method = mode === 'create' ? 'POST' : 'PUT';

    const body: Record<string, unknown> = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      kind,
      isDefault,
    };
    if (mode === 'create') {
      body.apiKey = trimmedKey;
    } else if (trimmedKey.length > 0) {
      body.apiKey = trimmedKey;
    }

    startTransition(async () => {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        setError('网络错误，请重试');
        return;
      }

      if (res.ok) {
        if (mode === 'create') {
          const data = (await res.json().catch(() => null)) as
            | { data?: { id?: string } }
            | null;
          const newId = data?.data?.id;
          router.push(onSavedRedirect ?? (newId ? `/settings/models/${newId}` : '/settings/models'));
        } else {
          router.refresh();
        }
        return;
      }

      if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? '参数无效');
        return;
      }
      setError(`保存失败 (${res.status})`);
    });
  }

  const apiKeyPlaceholder =
    mode === 'edit' ? '不修改请留空（已保存：' + (initial?.apiKeyMasked ?? '') + '）' : '';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      <div className="space-y-2">
        <Label htmlFor="preset">预设</Label>
        <select
          id="preset"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={preset}
          onChange={(e) => applyPreset(e.target.value as PresetId)}
          disabled={isPending}
        >
          <option value="">— 自定义 —</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          选择预设会自动填入 Base URL 与 Model 字段（M3 内置）。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">名称</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          required
          disabled={isPending}
          placeholder="例如：DeepSeek 主力"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="baseUrl">Base URL</Label>
        <Input
          id="baseUrl"
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          required
          disabled={isPending}
          placeholder="https://api.deepseek.com/v1"
        />
        {kind === 'embedding' ? (
          <p className="text-xs text-muted-foreground">
            向量模型：Base URL 需指向 OpenAI 兼容的 <code>/embeddings</code> 接口前缀（如 <code>https://dashscope.aliyuncs.com/compatible-mode/v1</code>）。
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key</Label>
        <Input
          id="apiKey"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          maxLength={512}
          autoComplete="off"
          disabled={isPending}
          placeholder={apiKeyPlaceholder}
        />
        <p className="text-xs text-muted-foreground">
          {mode === 'edit'
            ? '留空表示不修改当前 Key。'
            : 'Key 入库前会使用 AES-256-GCM 加密。'}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="model">Model</Label>
        <Input
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          maxLength={128}
          required
          disabled={isPending}
          placeholder="例如：deepseek-chat"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="kind">类型</Label>
        <select
          id="kind"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'chat' | 'embedding')}
          disabled={isPending}
        >
          <option value="chat">对话（chat）</option>
          <option value="embedding">向量（embedding）</option>
        </select>
        <p className="text-xs text-muted-foreground">
          对话模型用于聊天和摘要；向量模型用于笔记片段的语义检索。
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isDefault"
          type="checkbox"
          className="h-4 w-4 rounded border-input"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          disabled={isPending}
        />
        <Label htmlFor="isDefault" className="cursor-pointer">
          设为默认模型
        </Label>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? '保存中…' : '保存'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => router.push('/settings/models')}
        >
          取消
        </Button>
      </div>
    </form>
  );
}
