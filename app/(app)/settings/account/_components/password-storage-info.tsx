'use client';

// Card explaining where the password lives + how to recover if lost.
// Pure info; no state, no actions.

import { Database, KeyRound, ShieldCheck } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function PasswordStorageInfo() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          密码保存在哪里？怎么找回？
        </CardTitle>
        <CardDescription>
          给好奇和应急用的简短说明。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p className="flex items-start gap-2">
          <Database className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            你的密码以 bcrypt 哈希形式存在 SQLite 的{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              settings
            </code>{' '}
            表里，键名是{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              password_hash
            </code>
            。明文密码只在第一次启动时从{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              .env
            </code>{' '}
            里的{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              APP_PASSWORD
            </code>{' '}
            读取，写入哈希后就可以从{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              .env
            </code>{' '}
            删掉。
          </span>
        </p>

        <p className="flex items-start gap-2">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong className="text-foreground">密码忘了怎么办：</strong>
            SSH 到 NAS，编辑{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              /volume1/docker/ai-kb/.env
            </code>{' '}
            ，把{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              APP_PASSWORD=新密码
            </code>{' '}
            写进去；在项目目录里跑一次{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              npm run bootstrap
            </code>{' '}
            （它会检测到有新的明文密码、就把旧哈希覆盖）；然后{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              docker compose restart
            </code>{' '}
            重启容器，用新密码登录即可。
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
