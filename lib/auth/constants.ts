// Edge-runtime-safe constants for the auth subsystem. This module must
// have NO Node-only imports (`fs`, `path`, `crypto`, `node:*`, etc.) so
// that the Next.js Edge bundler (which serves `middleware.ts` and any
// `runtime = 'edge'` route) can include it without dragging in
// `lib/env.ts` (which uses `path` and therefore breaks in Edge).

/**
 * Name of the HttpOnly cookie that carries the JWT session token.
 * MUST match the value the login route sets on the response.
 */
export const AUTH_COOKIE = 'ai_kb_token';

/**
 * JWT lifetime in seconds (default: 7 days).
 */
export const AUTH_TTL_SECONDS = 60 * 60 * 24 * 7;
