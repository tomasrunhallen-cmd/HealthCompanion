// Web version: the app lock is a PIN typed into the app. Browsers have no Face ID prompt
// an app can use for a plain lock, so a code it is. The PIN is stored as a salted hash.

import { checkPin, makePinRecord, validPin, type PinRecord } from './pin';

export interface LockSupport {
  available: boolean;
  reason: string | null;
}

const KEY = 'dagsljus.pin.v1';

export const usesPin = true;

function read(): PinRecord | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as PinRecord) : null;
  } catch {
    return null;
  }
}

export async function hasPin(): Promise<boolean> {
  return read() != null;
}

export async function lockSupport(): Promise<LockSupport> {
  return read()
    ? { available: true, reason: 'Låses med din kod.' }
    : { available: false, reason: 'Välj en kod med 4 till 8 siffror för att låsa appen.' };
}

export async function setPin(pin: string): Promise<void> {
  if (!validPin(pin)) throw new Error('Koden ska vara 4 till 8 siffror.');
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  const rec = makePinRecord(pin, salt);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(rec));
  } catch {
    throw new Error('Webbläsaren tillåter inte att koden sparas.');
  }
}

export async function clearPin(): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

export async function unlock(pin?: string): Promise<boolean> {
  const rec = read();
  if (!rec) return true;
  return pin != null && checkPin(pin, rec);
}
