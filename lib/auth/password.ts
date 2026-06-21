// Password verification + rotation.

import bcrypt from 'bcryptjs';
import { getStoredPasswordHash, setStoredPasswordHash } from './init';

export async function verifyPassword(plaintext: string): Promise<boolean> {
  const hash = getStoredPasswordHash();
  if (!hash) return false;
  return bcrypt.compare(plaintext, hash);
}

export async function setPassword(plaintext: string): Promise<void> {
  if (plaintext.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const hash = await bcrypt.hash(plaintext, 12);
  setStoredPasswordHash(hash);
}

export function isPasswordConfigured(): boolean {
  return getStoredPasswordHash() !== null;
}
