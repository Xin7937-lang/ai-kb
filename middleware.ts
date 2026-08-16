// Route protection middleware (Edge runtime).
//
// Behavior:
//   - /api/auth/login                     -> always allowed
//   - /uploads/*                          -> public (so <img> tags load
//                                            without auth cookies; S5 sets
//                                            long-cache headers since
//                                            filenames are nanoid-immutable)
//   - /_next/*, /favicon.ico              -> Next.js internals, skipped
//   - /api/* + Authorization: Bearer ...  -> pass-through; the Node route
//                                            handler calls getSession()
//                                            which validates the token
//                                            against settings.agent_api_token_hash
//   - everything else under /api/*        -> require JWT cookie, else 401 JSON
//   - every page route                    -> require JWT cookie, else
//                                            redirect to /login?next=<original>
//
// We use Edge-compatible JWT verification (jose + manual cookie parse)
// so this stays in the Edge runtime without pulling in better-sqlite3
// or bcrypt. The deeper checks (DB lookups, etc.) happen in
// `lib/auth/session.ts` on the Node side when each API route / page
// calls `getSession()`.
//
// We deliberately do NOT validate the bearer token here: Edge can't
// access SQLite to read the stored hash. A malformed/expired bearer
// will be rejected by `getSession()` with a 401 from the route handler.

import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionFromCookieHeader } from './lib/auth/edge';

const PUBLIC_PATHS = new Set<string>(['/api/auth/login']);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname.startsWith('/uploads/')) return true;
  return false;
}

/**
 * True when the request carries an `Authorization: Bearer ...` header.
 * Used to short-circuit the cookie check on /api/* so the Node route
 * handler can validate the token against the DB-stored hash.
 */
function hasBearerAuth(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  return typeof auth === 'string' && /^Bearer\s+/i.test(auth);
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // API routes: a bearer header means "I'm a LAN agent, validate me
  // against the agent_api_token_hash". Skip the cookie check and let
  // the route handler call getSession(), which honors bearer-first.
  if (pathname.startsWith('/api/') && hasBearerAuth(request)) {
    return NextResponse.next();
  }

  const session = await verifySessionFromCookieHeader(request.headers.get('cookie'));

  // API routes: 401 JSON instead of redirect
  if (pathname.startsWith('/api/')) {
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Page routes: redirect to /login (preserving destination via ?next=)
  if (!session) {
    if (pathname === '/login') return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Already authenticated and visiting /login? Bounce to home.
  if (pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next.js internals and the /uploads static dir.
    '/((?!_next/static|_next/image|favicon.ico|uploads).*)',
  ],
};
