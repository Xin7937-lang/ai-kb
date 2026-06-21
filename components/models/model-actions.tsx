'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Props = {
  modelId: string;
  isDefault: boolean;
};

type Action = 'idle' | 'setting' | 'deleting';

export function ModelActions({ modelId, isDefault }: Props) {
  const router = useRouter();
  const [action, setAction] = useState<Action>('idle');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleSetDefault() {
    setAction('setting');
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/models/${modelId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isDefault: true }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { message?: string };
          setError(data.message ?? `操作失败 (${res.status})`);
          setAction('idle');
          return;
        }
        router.refresh();
        setAction('idle');
      } catch (err) {
        setError(err instanceof Error ? err.message : '网络错误');
        setAction('idle');
      }
    });
  }

  function handleDelete() {
    const ok = window.confirm('确定删除这个模型配置？此操作无法撤销。');
    if (!ok) return;
    setAction('deleting');
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/models/${modelId}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? `操作失败 (${res.status})`);
          setAction('idle');
          return;
        }
        router.push('/settings/models');
      } catch (err) {
        setError(err instanceof Error ? err.message : '网络错误');
        setAction('idle');
      }
    });
  }

  const busy = action !== 'idle';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!isDefault ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleSetDefault}
            disabled={busy}
          >
            {action === 'setting' ? '设置中…' : '设为默认'}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="destructive"
          onClick={handleDelete}
          disabled={busy}
        >
          {action === 'deleting' ? '删除中…' : '删除'}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
