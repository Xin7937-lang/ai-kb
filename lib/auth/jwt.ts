// JWT helpers built on `jose`.
//
// Single-user app: the token subject is always the literal "admin".
// We don't need user records — a valid token simply means "logged in".

import { SignJWT, jwtVerify } from 'jose';
import { AUTH_TTL_SECONDS } from './constants';

const ALG = 'HS256';
const ISSUER = 'ai-kb';
const SUBJECT = 'admin';

// We read JWT_SECRET from process.env directly (instead of importing from
// `lib/env.ts`) so this module is safe to bundle into the Edge runtime
// via the middleware's import chain. `lib/env.ts` uses `path`, which
// would otherwise blow up the Edge bundler.
//
// Fail-fast validation still happens once on Node startup via
// `lib/env.ts` (where `JWT_SECRET` is `requireEnv`'d at module load) and
// again here as a defensive check the first time we sign/verify.
function getSecret(): Uint8Array {
  const hex = process.env.JWT_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'JWT_SECRET env var is missing or not a 64-char hex string; ' +
        'check your .env / docker env_file',
    );
  }
  return new TextEncoder().encode(hex);
}

let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!_secret) _secret = getSecret();
  return _secret;
}

export type Session = {
  sub: string;
  iat: number;
  exp: number;
};

export async function signToken(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setExpirationTime(`${AUTH_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      algorithms: [ALG],
    });
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}
