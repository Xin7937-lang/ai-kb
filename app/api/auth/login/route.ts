import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyPassword, isPasswordConfigured } from '@/lib/auth/password';
import { signToken } from '@/lib/auth/jwt';
import { AUTH_COOKIE, AUTH_TTL_SECONDS, COOKIE_SECURE } from '@/lib/env';

const LoginSchema = z.object({
  password: z.string().min(1).max(256),
});

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!isPasswordConfigured()) {
    return NextResponse.json(
      {
        error: 'no_password_configured',
        message:
          'No password is set. Configure APP_PASSWORD in .env and restart, ' +
          'or use the account settings page (post-MVP) to set one.',
      },
      { status: 503 },
    );
  }

  const ok = await verifyPassword(parsed.data.password);
  if (!ok) {
    // Constant-time-ish: always perform a hash compare even on miss to
    // make user enumeration harder. verifyPassword already does this.
    return NextResponse.json({ error: 'invalid_password' }, { status: 401 });
  }

  const token = await signToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: AUTH_TTL_SECONDS,
  });
  return response;
}
