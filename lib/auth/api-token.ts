// Agent API bearer token helpers (ticket 11).
//
// Single long-lived token that LAN agents (e.g. another Claude Code
// instance, a CLI script, or any HTTP client on the trusted network)
// can use to authenticate without managing a JWT cookie.
//
// Token shape:
//   - Generated: 32 random bytes, hex-encoded → 64-char lowercase hex.
//   - Stored: SHA-256(token + PEPPER), hex-encoded (64 chars).
//
// Why SHA-256 and not bcrypt:
//   The token is already 256 bits of cryptographic randomness — adding
//   bcrypt's slow KDF on top doesn't materially improve security and
//   would make the request path (already per-request) noticeably slower
//   for many concurrent agents. SHA-256 is the standard for high-entropy
//   API token storage.
//
// Why a pepper:
//   A pure SHA-256 of the token is vulnerable to a brute-force lookup
//   table ONLY if an attacker has access to BOTH the DB AND a token
//   dictionary — neither of which is in scope here. The pepper is a
//   cheap defense-in-depth: an attacker who exfiltrates `settings` but
//   not the source code still can't precompute hashes offline against
//   a stolen DB snapshot.
//
// The pepper lives in source (not env) so that:
//   1. A fresh deploy with the same DB snapshot still validates old tokens.
//   2. There's nothing to forget to set in `.env`.
// Rotate the pepper by changing this constant + invalidating all tokens
// (the user just regenerates via /api/settings/agent-api-token).

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const PEPPER = 'ai-kb:agent-api-token:v1';
const TOKEN_BYTES = 32;
const TOKEN_HEX_LENGTH = TOKEN_BYTES * 2; // 64
const HASH_HEX_LENGTH = 64; // SHA-256 hex is always 64 chars

/**
 * Generate a new raw token. Each call produces a different value
 * (sourced from `crypto.randomBytes`, which is a CSPRNG).
 *
 * The caller is responsible for showing this value to the user exactly
 * once — after `setAgentApiTokenHash(hashAgentApiToken(token))` the raw
 * form should be discarded everywhere except the API response.
 */
export function generateAgentApiToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Hash a raw token with the pepper. Deterministic: same raw → same hash.
 * The hex output is what gets persisted in `settings.agent_api_token_hash`.
 */
export function hashAgentApiToken(raw: string): string {
  if (!isWellFormedToken(raw)) {
    throw new Error(
      `hashAgentApiToken: raw must be ${TOKEN_HEX_LENGTH} lowercase hex chars`,
    );
  }
  return createHash('sha256').update(raw + PEPPER).digest('hex');
}

/**
 * Validate a raw token against a stored hash. Returns false (not throws)
 * on any shape mismatch so callers can treat this as a pure predicate.
 *
 * Comparison is timing-safe to avoid leaking the hash via response-time
 * analysis. `timingSafeEqual` requires both buffers to be the same length;
 * we check the length first and short-circuit false before comparing.
 */
export function verifyAgentApiToken(raw: string, storedHash: string): boolean {
  if (!isWellFormedToken(raw)) return false;
  if (typeof storedHash !== 'string') return false;
  if (storedHash.length !== HASH_HEX_LENGTH) return false;

  const expected = Buffer.from(storedHash, 'hex');
  if (expected.length !== TOKEN_BYTES) return false; // defensive — already length-checked above

  const actual = Buffer.from(hashAgentApiToken(raw), 'hex');
  // Both buffers are now TOKEN_BYTES long.
  return timingSafeEqual(expected, actual);
}

function isWellFormedToken(raw: string): boolean {
  return (
    typeof raw === 'string' &&
    raw.length === TOKEN_HEX_LENGTH &&
    /^[0-9a-f]+$/.test(raw)
  );
}
