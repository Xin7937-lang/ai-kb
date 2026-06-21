// POST /api/auth/password -- change the login password.
//
// Verifies the supplied currentPassword against the bcrypt hash stored
// in `settings.password_hash`, then replaces the hash with one derived
// from newPassword. On success, any existing session cookies remain
// valid (the password is checked at login, not on every request).

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { verifyPassword, setPassword } from '@/lib/auth/password';

export const runtime = 'nodejs';

const Body = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

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
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: '新密码至少 8 个字符',
      },
      { status: 400 },
    );
  }

  const { currentPassword, newPassword } = parsed.data;
  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: 'same_password', message: '新密码必须与旧密码不同' },
      { status: 400 },
    );
  }

  const ok = await verifyPassword(currentPassword);
  if (!ok) {
    return NextResponse.json(
      { error: 'wrong_current_password', message: '当前密码不正确' },
      { status: 401 },
    );
  }

  try {
    await setPassword(newPassword);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'set_password_failed',
        message: err instanceof Error ? err.message : '未知错误',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
