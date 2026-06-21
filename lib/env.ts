// Centralized, validated env access. Throws at startup if anything required is missing.
// Pattern: each var is read once, validated, and re-exported as a typed constant.

import path from 'path';

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. ` +
        `Check .env.example for the full list.`,
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * JWT signing secret. Must be 32+ bytes of entropy.
 * Generate with: openssl rand -hex 32
 */
export const JWT_SECRET: string = requireEnv('JWT_SECRET');

/**
 * AES-256-GCM key (32 bytes / 64 hex chars) used to encrypt model API keys at rest.
 * Generate with: openssl rand -hex 32
 */
export const ENCRYPTION_KEY: string = requireEnv('ENCRYPTION_KEY');

/**
 * Initial app password. Optional after first run -- the hash lives in
 * `settings.password_hash` and the plaintext is no longer needed. Startup
 * will hash it once and clear the in-memory value.
 */
export const APP_PASSWORD: string | undefined = process.env.APP_PASSWORD;

export const DB_PATH: string = optionalEnv(
  'DB_PATH',
  path.join(process.cwd(), 'data', 'kb.db'),
);

export const UPLOADS_DIR: string = optionalEnv(
  'UPLOADS_DIR',
  path.join(process.cwd(), 'uploads'),
);

export const BACKUPS_DIR: string = optionalEnv(
  'BACKUPS_DIR',
  path.join(process.cwd(), 'backups'),
);

/**
 * JWT cookie name. Keep consistent between login response and middleware.
 * Re-exported from `lib/auth/constants` so the Edge-runtime middleware
 * can import it without pulling in this Node-only module.
 */
export { AUTH_COOKIE } from './auth/constants';

/**
 * JWT TTL in seconds (7 days by default).
 * Re-exported from `lib/auth/constants` for the same reason.
 */
export { AUTH_TTL_SECONDS } from './auth/constants';

/**
 * Whether to set the Secure flag on the auth cookie.
 * Defaults to false — set to "true" only when behind HTTPS.
 */
export const COOKIE_SECURE = optionalEnv('COOKIE_SECURE', 'false') === 'true';

/**
 * Maximum characters from a note that we send into the summarization prompt.
 * Plan section 9: truncate to 8k tokens; conservatively use 24k chars
 * (roughly 4 chars per token).
 */
export const SUMMARY_INPUT_MAX_CHARS = 24_000;
