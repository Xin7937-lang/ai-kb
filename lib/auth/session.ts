// Server-side session helpers.
// Used by server components and API routes (Node runtime).

import { cookies } from 'next/headers';
import { AUTH_COOKIE } from './constants';
import { verifyToken, type Session } from './jwt';

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new UnauthorizedError();
  }
  return session;
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}
