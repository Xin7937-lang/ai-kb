// lib/auth/session-bearer.test.ts
//
// Throwaway tests for the bearer + cookie auth resolution in
// lib/auth/session.ts. Uses the pure helper `resolveSessionFromHeaders`
// so we don't need a Next request context (and therefore don't need to
// import next/headers, which only works inside Next).
//
// Run: npx tsx lib/auth/session-bearer.test.ts

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);

// Promote to module so tsc treats this file's top-level `Case`/`main`
// as its own scope (otherwise TS2300 / TS2393 from sibling test files).
export {};

type Case = {
  name: string;
  check: () => boolean;
};

let bearerMatchResult: unknown = null;
let bearerMismatchResult: unknown = null;
let bearerHeaderJunkResult: unknown = null;
let bearerOnlyCookieResult: unknown = null;
let bearerBothValidResult: unknown = null;
let bearerNoAuthNoCookieResult: unknown = null;
let bearerSub: string | null = null;
let cookieMatchSub: string | null = null;
let cookieMissSub: unknown = null;
let cookieMissNoToken: unknown = null;
let storedNullBearerHeader: unknown = null;

async function main(): Promise<void> {
  const {
    resolveSessionFromHeaders,
  } = await import('./session');
  const {
    generateAgentApiToken,
    hashAgentApiToken,
  } = await import('./api-token');
  const { signToken } = await import('./jwt');

  // ----- Bearer path -----
  const raw = generateAgentApiToken();
  const storedHash = hashAgentApiToken(raw);

  bearerMatchResult = await resolveSessionFromHeaders(
    `Bearer ${raw}`,
    null,
    storedHash,
  );
  bearerSub = (bearerMatchResult as { sub: string } | null)?.sub ?? null;

  bearerMismatchResult = await resolveSessionFromHeaders(
    `Bearer ${generateAgentApiToken()}`,
    null,
    storedHash,
  );

  bearerHeaderJunkResult = await resolveSessionFromHeaders(
    'NotBearer xyz',
    null,
    storedHash,
  );

  // A valid bearer header AND a valid cookie are both present. The
  // bearer path MUST win (it short-circuits before cookie lookup) — a
  // caller using explicit Authorization shouldn't accidentally ride an
  // older session cookie.
  const jwt = await signToken();
  bearerBothValidResult = await resolveSessionFromHeaders(
    `Bearer ${raw}`,
    jwt,
    storedHash,
  );

  // ----- Cookie path (no bearer header, no Authorization at all) -----
  cookieMatchSub = (
    await resolveSessionFromHeaders(null, jwt, null)
  )?.sub ?? null;
  cookieMissSub = (
    await resolveSessionFromHeaders(null, 'not-a-real-jwt', null)
  );
  cookieMissNoToken = await resolveSessionFromHeaders(null, null, null);

  // ----- No auth at all -----
  bearerNoAuthNoCookieResult = await resolveSessionFromHeaders(
    null,
    null,
    null,
  );

  // ----- Stored hash null but Authorization present -----
  // No token configured → bearer header alone must fail.
  storedNullBearerHeader = await resolveSessionFromHeaders(
    `Bearer ${raw}`,
    null,
    null,
  );

  const cases: Case[] = [
    {
      name: 'matching bearer → returns Session with sub="agent"',
      check: () =>
        bearerMatchResult !== null &&
        (bearerMatchResult as { sub: string }).sub === 'agent',
    },
    {
      name: 'matching bearer → Session.exp is in the future',
      check: () => {
        const s = bearerMatchResult as { exp: number } | null;
        return s !== null && s.exp * 1000 > Date.now();
      },
    },
    {
      name: 'wrong raw bearer against stored hash → null (no fallthrough)',
      check: () => bearerMismatchResult === null,
    },
    {
      name: 'header looks like Bearer but malformed value → null (no fallthrough to cookie)',
      check: () => bearerHeaderJunkResult === null,
    },
    {
      name: 'bearer + cookie both present → bearer wins (sub="agent", not admin)',
      check: () =>
        bearerBothValidResult !== null &&
        (bearerBothValidResult as { sub: string }).sub === 'agent',
    },
    {
      name: 'no bearer header + valid cookie → Session with sub="admin"',
      check: () => cookieMatchSub === 'admin',
    },
    {
      name: 'no bearer header + invalid cookie token → null',
      check: () => cookieMissSub === null,
    },
    {
      name: 'no bearer header + no cookie token → null',
      check: () => cookieMissNoToken === null,
    },
    {
      name: 'no Authorization, no cookie, no stored hash → null',
      check: () => bearerNoAuthNoCookieResult === null,
    },
    {
      name: 'bearer header present but no token configured → null',
      check: () => storedNullBearerHeader === null,
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
