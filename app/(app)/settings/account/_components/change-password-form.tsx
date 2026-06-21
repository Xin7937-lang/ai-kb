'use client';

// Change-password form for the Account settings page.

import { useState, useTransition } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (next.length < 8) {
      setError('新密码至少 8 个字符');
      return;
    }
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (current === next) {
      setError('新密码必须与旧密码不同');
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: current,
            newPassword: next,
          }),
        });
        if (res.ok) {
          setSuccess(true);
          setCurrent('');
          setNext('');
          setConfirm('');
          return;
        }
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setError(data.message ?? data.error ?? '修改失败');
      } catch (err) {
        console.error('[change-password] failed:', err);
        setError('网络错误，请重试');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          修改登录密码
        </CardTitle>
        <CardDescription>
          改完后用新密码重新登录即可。不需要重启服务。
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current">当前密码</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              disabled={isPending}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="next">新密码</Label>
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              disabled={isPending}
              required
              minLength={8}
            />
            <p className="text-xs text-muted-foreground">至少 8 个字符</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">确认新密码</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={isPending}
              required
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
              密码已更新。下次登录请使用新密码。
            </p>
          ) : null}
        </CardContent>
        <div className="flex justify-end p-6 pt-0">
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                提交中…
              </>
            ) : (
              '保存新密码'
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}
