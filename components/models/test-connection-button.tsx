'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  modelId: string;
};

type TestState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'fail'; message: string };

export function TestConnectionButton({ modelId }: Props) {
  const [state, setState] = useState<TestState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setState({ kind: 'loading' });
    startTransition(async () => {
      try {
        const res = await fetch(`/api/models/${modelId}/test`, {
          method: 'POST',
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (res.ok && data.ok) {
          setState({ kind: 'ok' });
        } else {
          setState({
            kind: 'fail',
            message: data.error ?? `请求失败 (${res.status})`,
          });
        }
      } catch (err) {
        setState({
          kind: 'fail',
          message: err instanceof Error ? err.message : '网络错误',
        });
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? '测试中…' : '测试连接'}
      </Button>
      {state.kind === 'ok' ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          连接成功
        </p>
      ) : null}
      {state.kind === 'fail' ? (
        <p className="text-sm text-destructive" role="alert">
          失败：{state.message}
        </p>
      ) : null}
    </div>
  );
}
