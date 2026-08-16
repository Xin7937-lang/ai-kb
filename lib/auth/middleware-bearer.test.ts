// lib/auth/middleware-bearer.test.ts
//
// Verifies the Edge middleware behavior added by the "Bearer on /api/*"
// fix (ticket 11 follow-up). The middleware itself runs in Edge, but it
// only inspects headers and delegates to Node route handlers for
// validation — so we can test it directly with NextRequest objects
// without standing up a full Next dev server.
//
// Run: npx tsx lib/auth/middleware-bearer.test.ts

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);

export {};

type Case = { name: string; check: () => boolean };

let apiBearerPass: boolean | null = null;
let apiNoAuthReject: boolean | null = null;
let apiBadBearerPassToRoute: boolean | null = null;
let pageBearerStillRedirects: boolean | null = null;
let pageNoAuthRedirects: boolean | null = null;

async function main(): Promise<void> {
  const { NextRequest } = await import('next/server');
  const { middleware } = await import('../../middleware');

  // ---- 1. /api/notes + valid-looking Bearer → middleware must NOT 401 ----
  const reqBearer = new NextRequest('http://localhost/api/notes', {
    headers: { authorization: 'Bearer deadbeef' },
  });
  const resBearer = await middleware(reqBearer);
  // NextResponse.next() yields a 200 with x-middleware-rewrite/next headers.
  // Anything other than 401 means the request reached the route handler.
  apiBearerPass = resBearer.status !== 401;

  // ---- 2. /api/notes + no auth → middleware must 401 JSON ----
  const reqNone = new NextRequest('http://localhost/api/notes');
  const resNone = await middleware(reqNone);
  apiNoAuthReject = resNone.status === 401;

  // ---- 3. /api/notes + garbage Bearer → middleware must NOT 401
  //         (route handler will validate and 401 from getSession).
  //         This is intentional: we want the route handler to own token
  //         validation so it can hit the DB-stored hash.
  const reqGarbage = new NextRequest('http://localhost/api/notes', {
    headers: { authorization: 'Bearer not-a-real-token' },
  });
  const resGarbage = await middleware(reqGarbage);
  apiBadBearerPassToRoute = resGarbage.status !== 401;

  // ---- 4. Page route / + Bearer → still requires cookie, redirect to /login ----
  const reqPageBearer = new NextRequest('http://localhost/', {
    headers: { authorization: 'Bearer deadbeef' },
  });
  const resPageBearer = await middleware(reqPageBearer);
  pageBearerStillRedirects =
    resPageBearer.status === 307 || resPageBearer.status === 302;

  // ---- 5. Page route / + no auth → redirect to /login ----
  const reqPageNone = new NextRequest('http://localhost/');
  const resPageNone = await middleware(reqPageNone);
  pageNoAuthRedirects =
    resPageNone.status === 307 || resPageNone.status === 302;

  const cases: Case[] = [
    {
      name: '/api/notes with Bearer header → middleware does NOT 401',
      check: () => apiBearerPass === true,
    },
    {
      name: '/api/notes with no auth header → middleware returns 401',
      check: () => apiNoAuthReject === true,
    },
    {
      name: '/api/notes with malformed Bearer → middleware passes through (route handler will 401)',
      check: () => apiBadBearerPassToRoute === true,
    },
    {
      name: 'page route / with Bearer → middleware still requires cookie (redirect)',
      check: () => pageBearerStillRedirects === true,
    },
    {
      name: 'page route / with no auth → middleware redirects to /login',
      check: () => pageNoAuthRedirects === true,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    try {
      if (!c.check()) {
        console.error(`FAIL: ${c.name}`);
        failed++;
      } else {
        console.log(`PASS: ${c.name}`);
      }
    } catch (err) {
      console.error(`ERROR in ${c.name}:`, err);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} tests passed`);
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(1);
});