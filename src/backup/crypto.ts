// Password-protected export file: PBKDF2-SHA256 key derivation and AES-256-GCM.
// Pure JavaScript (noble), so it runs the same on iOS, Android, web and in tests.

import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const BACKUP_FORMAT = 'dagsljus-backup';
export const DEFAULT_ITERATIONS = 210_000;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  kdf: { name: 'pbkdf2-sha256'; iterations: number; salt: string };
  cipher: { name: 'aes-256-gcm'; iv: string };
  data: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return new Uint8Array(out);
}

// Own UTF-8 helpers: TextDecoder is not available on every React Native engine.
export function utf8Encode(str: string): Uint8Array {
  const out: number[] = [];
  for (const ch of str) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export function utf8Decode(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const x = b[i++];
    let c: number;
    if (x < 0x80) c = x;
    else if (x < 0xe0) c = ((x & 31) << 6) | (b[i++] & 63);
    else if (x < 0xf0) c = ((x & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else c = ((x & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    out += String.fromCodePoint(c);
  }
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8Encode(password), salt, { c: iterations, dkLen: 32 });
}

export async function encryptBackup(
  plaintext: string,
  password: string,
  randomBytes: (n: number) => Uint8Array,
  iterations = DEFAULT_ITERATIONS,
): Promise<BackupFile> {
  if (password.length < 8) throw new Error('Lösenordet måste ha minst 8 tecken');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, iterations);
  const ct = gcm(key, iv).encrypt(utf8Encode(plaintext));
  return {
    format: BACKUP_FORMAT,
    version: 1,
    kdf: { name: 'pbkdf2-sha256', iterations, salt: toBase64(salt) },
    cipher: { name: 'aes-256-gcm', iv: toBase64(iv) },
    data: toBase64(ct),
  };
}

export async function decryptBackup(file: BackupFile, password: string): Promise<string> {
  if (file?.format !== BACKUP_FORMAT) throw new Error('Filen är inte en Dagsljus-backup');
  const key = await deriveKey(password, fromBase64(file.kdf.salt), file.kdf.iterations);
  try {
    const pt = gcm(key, fromBase64(file.cipher.iv)).decrypt(fromBase64(file.data));
    return utf8Decode(pt);
  } catch {
    throw new Error('Fel lösenord eller skadad fil');
  }
}
