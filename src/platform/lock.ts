// Web preview and tests: no app lock available.
export interface LockSupport {
  available: boolean;
  reason: string | null;
}

export async function lockSupport(): Promise<LockSupport> {
  return { available: false, reason: 'Applås finns bara i appen på telefonen.' };
}

export async function unlock(): Promise<boolean> {
  return true;
}
