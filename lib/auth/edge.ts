// Auth helpers usable from both Edge middleware and Node API routes.
// Edge-safe: only uses jose + string ops, no DB / no fs. Importantly,
// this module imports its constants from `./constants` (a Node-free
// module) instead of from `../env` (which uses `path` and would
// otherwise break the Edge bundler with "The edge runtime does not
// support Node.js 'path' module").

import { AUTH_COOKIE } from './constants';
import { verifyToken, type Session } from './jwt';

/**
 * Verify a session from a raw Cookie header. Returns null if missing/invalid.
 * Works in Edge runtime (used by middleware) and Node (used by API routes).
 */
export async function verifySessionFromCookieHeader(
  cookieHeader: string | null | undefined,
): Promise<Session | null> {
  if (!cookieHeader) return null;
  // Parse cookie header manually — avoids Next.js `cookies()` which is
  // not available in middleware.
  const token = parseCookie(cookieHeader, AUTH_COOKIE);
  if (!token) return null;
  return verifyToken(token);
}

function parseCookie(header: string, name: string): string | null {
  const parts = header.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    if (k === name) {
      return decodeURIComponent(p.slice(eq + 1).trim());
    }
  }
  return null;
}
