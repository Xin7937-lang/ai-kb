# 11 — Agent API bearer token (LAN agents)

**What to build:** A long-lived bearer token mechanism so LAN agents (e.g. another Claude Code instance on a different machine, or any HTTP client on the trusted network) can authenticate without managing a JWT cookie. Single shared token, generated/rotated by the user, stored hashed in the existing `settings` KV.

**Blocked by:** none (independent of stages 1+2)

**Status:** ready-for-agent

- [ ] `lib/auth/api-token.ts` exports:
  - `generateAgentApiToken()` → `string` (raw 32-byte hex token, 64 chars)
  - `hashAgentApiToken(raw)` → `string` (SHA-256 of `raw + PEPPER`, hex)
  - `verifyAgentApiToken(raw, storedHash)` → `boolean` (timing-safe equal)
- [ ] Token entropy: 32 random bytes from `crypto.randomBytes`. Storage format: 64-char lowercase hex. Hash uses SHA-256 (not bcrypt — tokens are already high-entropy, no need for slow KDF) with a hardcoded pepper constant so a DB leak alone doesn't grant token reuse.
- [ ] `lib/auth/init.ts` adds three getters/setters:
  - `AGENT_API_TOKEN_HASH_KEY = 'agent_api_token_hash'`
  - `getAgentApiTokenHash()` → `string | null`
  - `setAgentApiTokenHash(hash)` → upserts the row
  - `clearAgentApiToken()` → deletes the row
- [ ] `lib/auth/session.ts` `getSession()` is extended:
  - If `Authorization: Bearer <token>` header is present, validate against `getAgentApiTokenHash()` via `verifyAgentApiToken`. On match return a synthetic Session `{ sub: 'agent', iat: now, exp: now + BEARER_TTL_SECONDS }` (no JWT verification, no DB write).
  - Cookie path unchanged.
  - Bearer path runs BEFORE cookie lookup — explicit Authorization wins.
- [ ] `lib/auth/constants.ts` adds `BEARER_TTL_SECONDS = 60 * 60 * 24 * 365` (1 year). The synthetic session's `exp` is informational; the bearer check itself is stateless.
- [ ] `app/api/settings/agent-api-token/route.ts`:
  - `PUT` — requireSession. Generate new token, hash, store. Return `{ data: { token, createdAt } }`. The raw token is in the response exactly once; the user must copy it immediately.
  - `DELETE` — requireSession. Clear the hash from settings. Returns `{ data: { cleared: true } }`.
  - `GET` — requireSession. Returns `{ data: { configured: boolean, createdAt: number | null } }`. Never returns the raw token or the hash.
  - All three routes: `export const runtime = 'nodejs'` (they touch SQLite).
- [ ] UI: extend `app/(app)/settings/agent/page.tsx` + the `AgentSettings` client component with an "API Token" section:
  - State 1: no token configured → "Generate" button.
  - State 2: token configured → "Regenerate" (with confirm), "Clear" (with confirm), and "Created at <date>" line. No token text shown in this state.
  - Immediately after generation: render the raw token with a copy button and a warning "Copy now — this is the only time it will be shown." Hide it on next page load.
- [ ] Unit tests (`lib/auth/api-token.test.ts`):
  - `generateAgentApiToken()` returns 64-char hex, two calls produce different values.
  - `hashAgentApiToken(raw)` is deterministic; different raws produce different hashes; same raw produces same hash.
  - `verifyAgentApiToken` returns true for matching raw+hash, false for any other raw against the same hash.
  - Wrong hash format / wrong-length raw returns false without throwing.
- [ ] Smoke update: add to `scripts/smoke-agent.ts` (or new `smoke-bearer.ts` — decide during impl) a scenario:
  - Seed a token hash via `setAgentApiTokenHash(hashAgentApiToken(generateAgentApiToken()))`.
  - Call an `/api/*` route directly (no cookie) with `Authorization: Bearer <raw>` → expect 200.
  - Same route with the wrong token → expect 401.
  - Same route with no auth header, no cookie → expect 401.
- [ ] No regression: existing 13 queries-deleted-at + 15 smoke-agent + all unit tests still pass.
- [ ] `README.md` + `docs/deploy-synology.md`: add a short "LAN agent access" section pointing at the new token mechanism. Note that the docker-compose `127.0.0.1:3000` binding must be loosened for LAN reachability.

Spec ref: ticket 11 design (this file). Co-Authored-By: Claude <noreply@anthropic.com>
