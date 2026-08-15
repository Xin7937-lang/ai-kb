// lib/auth/api-token.test.ts
//
// Throwaway unit tests for the bearer token helpers (ticket 11).
// Pure functions — no DB or fetch involved — so we don't even need
// process.env.DB_PATH, but set it anyway in case the imports cascade.
//
// Run: npx tsx lib/auth/api-token.test.ts

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'b'.repeat(64);

// Marker: without an import/export at the top, tsc treats this file as
// a script and its top-level `Case`/`main` collide with other test
// files (TS2300 / TS2393). A bare `export {}` promotes the file to a
// module so each test file gets its own scope.
export {};

type Case = {
  name: string;
  check: () => boolean;
};

let gen1: string;
let gen2: string;
let hashA: string;
let hashARepeat: string;
let hashB: string;
let verifyMatch: boolean | null = null;
let verifyMismatch: boolean | null = null;
let verifyBadRaw: boolean | null = null;
let verifyBadHash: boolean | null = null;
let verifyEmptyRaw: boolean | null = null;
let verifyUpperHexRaw: boolean | null = null;
let verifyWrongLengthRaw: boolean | null = null;
let throwOnBadShape: boolean | null = null;

async function main(): Promise<void> {
  const {
    generateAgentApiToken,
    hashAgentApiToken,
    verifyAgentApiToken,
  } = await import('./api-token');

  gen1 = generateAgentApiToken();
  gen2 = generateAgentApiToken();

  hashA = hashAgentApiToken(gen1);
  hashARepeat = hashAgentApiToken(gen1);
  hashB = hashAgentApiToken(gen2);

  verifyMatch = verifyAgentApiToken(gen1, hashA);
  verifyMismatch = verifyAgentApiToken(gen2, hashA);
  verifyBadRaw = verifyAgentApiToken('not-a-real-token', hashA);
  verifyBadHash = verifyAgentApiToken(
    gen1,
    'not-a-real-hash-at-all-not-even-the-right-length',
  );
  verifyEmptyRaw = verifyAgentApiToken('', hashA);
  verifyUpperHexRaw = verifyAgentApiToken(gen1.toUpperCase(), hashA);
  verifyWrongLengthRaw = verifyAgentApiToken(gen1.slice(0, 32), hashA);

  // hashAgentApiToken must throw on shape mismatch (not silently return
  // junk) — the route only calls it on a freshly-generated token, but a
  // bad-shape raw could indicate caller error worth surfacing.
  try {
    hashAgentApiToken('not-hex');
    throwOnBadShape = false;
  } catch {
    throwOnBadShape = true;
  }

  const cases: Case[] = [
    {
      name: 'generateAgentApiToken returns a 64-char lowercase hex string',
      check: () => /^[0-9a-f]{64}$/.test(gen1),
    },
    {
      name: 'two generate calls produce different values (CSPRNG sanity)',
      check: () => gen1 !== gen2,
    },
    {
      name: 'hashAgentApiToken is deterministic for the same raw',
      check: () => hashA === hashARepeat,
    },
    {
      name: 'hashAgentApiToken produces different output for different raws',
      check: () => hashA !== hashB,
    },
    {
      name: 'verifyAgentApiToken returns true for matching raw + hash',
      check: () => verifyMatch === true,
    },
    {
      name: 'verifyAgentApiToken returns false for wrong raw against same hash',
      check: () => verifyMismatch === false,
    },
    {
      name: 'verifyAgentApiToken returns false for junk raw',
      check: () => verifyBadRaw === false,
    },
    {
      name: 'verifyAgentApiToken returns false for junk hash (wrong length)',
      check: () => verifyBadHash === false,
    },
    {
      name: 'verifyAgentApiToken returns false for empty raw',
      check: () => verifyEmptyRaw === false,
    },
    {
      name: 'verifyAgentApiToken is case-sensitive (uppercase hex rejected)',
      check: () => verifyUpperHexRaw === false,
    },
    {
      name: 'verifyAgentApiToken returns false for truncated raw',
      check: () => verifyWrongLengthRaw === false,
    },
    {
      name: 'hashAgentApiToken throws on malformed raw (no silent corruption)',
      check: () => throwOnBadShape === true,
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
