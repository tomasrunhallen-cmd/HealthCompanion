// Tests and fallback: no app lock.
export interface LockSupport {
  available: boolean;
  reason: string | null;
}

/** True where the lock is a PIN typed into the app (web), false where the phone asks (Face ID). */
export const usesPin = false;

export async function lockSupport(): Promise<LockSupport> {
  return { available: false, reason: 'Applås finns inte här.' };
}

export async function unlock(_pin?: string): Promise<boolean> {
  return true;
}

export async function hasPin(): Promise<boolean> {
  return false;
}

export async function setPin(_pin: string): Promise<void> {}

export async function clearPin(): Promise<void> {}
