// A PIN for the web version's app lock. Stored as a salted PBKDF2 hash, never the PIN
// itself. Pure functions; lock.web.ts keeps the record in browser storage.

import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

export interface PinRecord {
  salt: string;
  hash: string;
  iterations: number;
}

const ITERATIONS = 60_000;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(s: string): Uint8Array {
  return new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
}

export function validPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export function makePinRecord(pin: string, salt: Uint8Array, iterations = ITERATIONS): PinRecord {
  const hash = pbkdf2(sha256, new TextEncoder().encode(pin), salt, { c: iterations, dkLen: 32 });
  return { salt: hex(salt), hash: hex(hash), iterations };
}

export function checkPin(pin: string, rec: PinRecord): boolean {
  const hash = pbkdf2(sha256, new TextEncoder().encode(pin), fromHex(rec.salt), { c: rec.iterations, dkLen: 32 });
  const a = hex(hash);
  // Constant-time comparison.
  let diff = a.length ^ rec.hash.length;
  for (let i = 0; i < Math.min(a.length, rec.hash.length); i++) diff |= a.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}
