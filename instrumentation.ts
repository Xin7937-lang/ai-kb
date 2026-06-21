// Next.js instrumentation hook.
//
// =====================================================================
// STATUS: INTENTIONALLY DISABLED
// =====================================================================
// This file exists in the repo but is NOT loaded at server startup
// because `experimental.instrumentationHook` is `false` in
// `next.config.mjs` (see the explanatory comment block in that file).
//
// Reason: enabling the hook on Next.js 14.2.7 + Windows triggers an
// upstream webpack 5 bug ("Module build failed: UnhandledSchemeError:
// Reading from 'node:async_hooks' is not handled by plugins" and a
// downstream "stream did not contain valid UTF-8" cascade) that prevents
// the standalone build from completing. The bug is independent of our
// code; the same code path is exercised by Next.js's own internal
// modules.
//
// The first-time DB migration + password hash that this hook would have
// performed is instead run by the explicit `npm run bootstrap` script
// (`scripts/bootstrap.ts`). For the deploy workflow, see
// `docs/deploy-synology.md` section 4.
//
// To re-enable this hook in the future:
//   1. Upgrade to a Next.js version where the upstream bug is fixed
//      (likely Next.js 15+), OR
//   2. Patch out the `node:` URI scheme in your build chain (e.g. add
//      a webpack NormalModuleReplacementPlugin that strips the prefix).
//   3. Set `experimental.instrumentationHook: true` in `next.config.mjs`.
//   4. Delete `scripts/bootstrap.ts` (or keep it as a manual fallback).
//
// Original (now-disabled) implementation below for reference.
// =====================================================================

export async function register() {
  // Only run on the Node server runtime, not Edge.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { migrate } = await import('./lib/db/migrate');
  const { initAuthFromEnv } = await import('./lib/auth/init');

  try {
    const result = migrate();
    if (result.applied.length > 0) {
      console.log(
        `[db] applied migrations: v${result.applied.join(', v')} (now at v${result.current})`,
      );
    } else {
      console.log(`[db] schema up to date (v${result.current})`);
    }
  } catch (err) {
    console.error('[db] migration failed:', err);
    throw err;
  }

  try {
    await initAuthFromEnv();
  } catch (err) {
    console.error('[auth] first-run init failed:', err);
    throw err;
  }
}
