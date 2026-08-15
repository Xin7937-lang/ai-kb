// Server-side session helpers.
// Used by server components and API routes (Node runtime).
//
// Two authentication paths are supported:
//   1. HttpOnly cookie carrying a signed JWT (the human user path).
//   2. `Authorization: Bearer <token>` header (LAN-agent path, ticket 11).
//
// Bearer wins over cookie when both are present — explicit Authorization
// is unambiguous. The bearer path is stateless: each request hashes the
// incoming token and compares against the persisted hash; no JWT issue,
// no DB write, no in-memory state. The synthetic Session returned for a
// successful bearer match has `sub: 'agent'` so downstream code can
// distinguish it from a real user session if needed (currently no code
// does, but the marker is cheap insurance).

import { cookies, headers } from 'next/headers';
import { AUTH_COOKIE, BEARER_TTL_SECONDS } from './constants';
import { verifyToken, type Session } from './jwt';
import { verifyAgentApiToken } from './api-token';
import { getAgentApiTokenHash } from './init';

/**
 * Pure helper: given raw `Authorization` header and `auth_cookie`
 * values, return a Session or null. Extracted so the auth logic can
 * be unit-tested without standing up a Next request context.
 *
 * Semantics:
 *   - If `authHeader` looks like a Bearer token, validate it against
 *     `storedHash`. On match return a synthetic 'agent' session. On
 *     mismatch (header present but token invalid) return null — we
 *     deliberately do NOT fall through to the cookie path, because
 *     mixing auth methods on the same request is a footgun.
 *   - Otherwise fall back to the JWT cookie path.
 */
export async function resolveSessionFromHeaders(
  authHeader: string | null,
  cookieToken: string | null,
  storedHash: string | null,
): Promise<Session | null> {
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (match) {
      const token = match[1].trim();
      if (storedHash && verifyAgentApiToken(token, storedHash)) {
        const now = Math.floor(Date.now() / 1000);
        return {
          sub: 'agent',
          iat: now,
          exp: now + BEARER_TTL_SECONDS,
        };
      }
      return null;
    }
  }

  if (!cookieToken) return null;
  return verifyToken(cookieToken);
}

export async function getSession(): Promise<Session | null> {
  const authHeader = headers().get('authorization');
  const cookieToken = cookies().get(AUTH_COOKIE)?.value ?? null;
  const storedHash = getAgentApiTokenHash();
  return resolveSessionFromHeaders(authHeader, cookieToken, storedHash);
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
