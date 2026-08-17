// First-run password bootstrap.
//
// On startup, if `APP_PASSWORD` is set in env and no password hash exists in
// `settings`, hash it and persist. The plaintext env value is no longer needed
// after this and can be cleared from .env.
//
// In S3 this module grows to also expose verify/rotate functions used by the
// login API and account settings page.

import bcrypt from 'bcryptjs';
import { APP_PASSWORD } from '../env';
import { getDb } from '../db/client';

const PASSWORD_HASH_KEY = 'password_hash';

export function getStoredPasswordHash(): string | null {
  const row = getDb()
    .prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    )
    .get(PASSWORD_HASH_KEY);
  return row?.value ?? null;
}

export function setStoredPasswordHash(hash: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(PASSWORD_HASH_KEY, hash);
}

/**
 * Called once on startup from instrumentation.ts.
 * Hashes APP_PASSWORD and persists it on the first run; no-op afterwards.
 */
export async function initAuthFromEnv(): Promise<void> {
  if (!APP_PASSWORD) {
    if (!getStoredPasswordHash()) {
      console.warn(
        '[auth] APP_PASSWORD is not set and no password hash exists. ' +
          'Set APP_PASSWORD in .env and restart to enable login.',
      );
    }
    return;
  }

  if (getStoredPasswordHash()) {
    // Password already configured; the env value is ignored.
    return;
  }

  const hash = await bcrypt.hash(APP_PASSWORD, 12);
  setStoredPasswordHash(hash);
  console.log(
    '[auth] initial password hashed and stored. ' +
      'You can now remove APP_PASSWORD from .env.',
  );
}

// ---------------------------------------------------------------------------
// Generic settings KV (used by General settings + any future getters)
// ---------------------------------------------------------------------------

/**
 * Read a single value from the `settings` KV table. Returns `null` if
 * the key has never been set. Keys we know about live next to this
 * file (see APP_TITLE_KEY below); add new getters there as the
 * settings surface grows.
 */
export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    )
    .get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value);
}

export const APP_TITLE_KEY = 'app_title';
export const APP_TITLE_DEFAULT = 'AI KB';

/**
 * Sidebar app title. Reads the user-customized value, falling back to
 * the default. The (app) layout calls this on every request.
 */
export function getAppTitle(): string {
  return getSetting(APP_TITLE_KEY) || APP_TITLE_DEFAULT;
}

export function setAppTitle(title: string): void {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    // Empty title is meaningless; reset to default.
    setSetting(APP_TITLE_KEY, APP_TITLE_DEFAULT);
    return;
  }
  // Cap at 32 chars so the sidebar layout doesn't break.
  setSetting(APP_TITLE_KEY, trimmed.slice(0, 32));
}

export const CHAT_RETRIEVE_LIMIT_KEY = 'chat_retrieve_limit';
export const CHAT_RETRIEVE_LIMIT_DEFAULT = 5;
export const CHAT_RETRIEVE_LIMIT_MIN = 1;
export const CHAT_RETRIEVE_LIMIT_MAX = 20;

export function getChatRetrieveLimit(): number {
  const raw = getSetting(CHAT_RETRIEVE_LIMIT_KEY);
  if (!raw) return CHAT_RETRIEVE_LIMIT_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return CHAT_RETRIEVE_LIMIT_DEFAULT;
  return Math.max(CHAT_RETRIEVE_LIMIT_MIN, Math.min(CHAT_RETRIEVE_LIMIT_MAX, n));
}

export function setChatRetrieveLimit(limit: number): void {
  const n = Math.max(CHAT_RETRIEVE_LIMIT_MIN, Math.min(CHAT_RETRIEVE_LIMIT_MAX, Math.round(limit)));
  setSetting(CHAT_RETRIEVE_LIMIT_KEY, String(n));
}

export const CHAT_WEB_SEARCH_KEY = 'chat_web_search_enabled';
export const CHAT_WEB_SEARCH_DEFAULT = false;

export function getChatWebSearchEnabled(): boolean {
  return getSetting(CHAT_WEB_SEARCH_KEY) === 'true';
}

export function setChatWebSearchEnabled(enabled: boolean): void {
  setSetting(CHAT_WEB_SEARCH_KEY, enabled ? 'true' : 'false');
}

// ---------------------------------------------------------------------------
// Agent tool-calling settings (ticket 01, slice 2/4)
// ---------------------------------------------------------------------------

export const AGENT_TOOLS_ENABLED_KEY = 'agent_tools_enabled';
export const AGENT_TOOLS_ENABLED_DEFAULT = false;

export function getAgentToolsEnabled(): boolean {
  // Strict: only the literal string 'true' enables. Missing or
  // malformed values fall back to the default (off) so a typo can't
  // accidentally expose tool-calling.
  return getSetting(AGENT_TOOLS_ENABLED_KEY) === 'true';
}

export function setAgentToolsEnabled(enabled: boolean): void {
  setSetting(AGENT_TOOLS_ENABLED_KEY, enabled ? 'true' : 'false');
}

export const AGENT_TOOL_LIMIT_KEY = 'agent_tool_limit';
export const AGENT_TOOL_LIMIT_DEFAULT = 5;

export function getAgentToolLimit(): number {
  const raw = getSetting(AGENT_TOOL_LIMIT_KEY);
  if (!raw) return AGENT_TOOL_LIMIT_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return AGENT_TOOL_LIMIT_DEFAULT;
  return n;
}

export function setAgentToolLimit(limit: number): void {
  setSetting(AGENT_TOOL_LIMIT_KEY, String(Math.round(limit)));
}

export const AGENT_BATCH_EDIT_DELETE_ENABLED_KEY =
  'agent_batch_edit_delete_enabled';
export const AGENT_BATCH_EDIT_DELETE_ENABLED_DEFAULT = false;

export function getAgentBatchEditDeleteEnabled(): boolean {
  return getSetting(AGENT_BATCH_EDIT_DELETE_ENABLED_KEY) === 'true';
}

export function setAgentBatchEditDeleteEnabled(enabled: boolean): void {
  setSetting(
    AGENT_BATCH_EDIT_DELETE_ENABLED_KEY,
    enabled ? 'true' : 'false',
  );
}

// ---------------------------------------------------------------------------
// Agent API bearer token (ticket 11 — LAN-agent access)
// ---------------------------------------------------------------------------

export const AGENT_API_TOKEN_HASH_KEY = 'agent_api_token_hash';
export const AGENT_API_TOKEN_CREATED_AT_KEY = 'agent_api_token_created_at';

export type AgentApiTokenStatus = {
  configured: boolean;
  createdAt: number | null;
};

/**
 * Read the currently-stored API-token hash, or null if no token has
 * ever been generated. Sessions with a matching `Authorization: Bearer`
 * header validate against this hash; see lib/auth/session.ts.
 */
export function getAgentApiTokenHash(): string | null {
  return getSetting(AGENT_API_TOKEN_HASH_KEY);
}

/**
 * Persist a freshly-generated hash. Callers are expected to display the
 * raw token to the user exactly once via the PUT response, then discard
 * the raw form. After this call returns, the hash is the only thing the
 * server stores.
 */
export function setAgentApiTokenHash(hash: string): void {
  setSetting(AGENT_API_TOKEN_HASH_KEY, hash);
  setSetting(AGENT_API_TOKEN_CREATED_AT_KEY, String(Date.now()));
}

/**
 * Clear the stored hash + created-at. After this, bearer auth no longer
 * succeeds for any token. Idempotent: safe to call when no token was
 * configured.
 */
export function clearAgentApiToken(): void {
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE key = ?').run(AGENT_API_TOKEN_HASH_KEY);
  db.prepare('DELETE FROM settings WHERE key = ?').run(AGENT_API_TOKEN_CREATED_AT_KEY);
}

export function getAgentApiTokenStatus(): AgentApiTokenStatus {
  const hash = getAgentApiTokenHash();
  if (!hash) return { configured: false, createdAt: null };
  const raw = getSetting(AGENT_API_TOKEN_CREATED_AT_KEY);
  const createdAt = raw ? Number.parseInt(raw, 10) : NaN;
  return { configured: true, createdAt: Number.isFinite(createdAt) ? createdAt : null };
}
