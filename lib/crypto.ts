// AES-256-GCM symmetric encryption for secrets at rest (model API keys).
// Storage format: base64( IV(12) || AUTH_TAG(16) || CIPHERTEXT )

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ENCRYPTION_KEY } from './env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

function getKey(): Buffer {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars). ` +
        `Got ${key.length} bytes. Regenerate with: openssl rand -hex 32`,
    );
  }
  return key;
}

/**
 * Encrypts a UTF-8 string and returns a self-contained base64 blob.
 * Safe to store directly in the database.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Decrypts a blob produced by {@link encrypt}. Throws if the auth tag doesn't verify
 * (i.e. the data was tampered with or the key changed).
 */
export function decrypt(blob: string): string {
  const key = getKey();
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted blob is too short to be valid');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
