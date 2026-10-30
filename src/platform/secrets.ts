// Web preview and tests: keys are kept in memory only and are gone when the page reloads.
// The phone uses secrets.native.ts (Keychain / Keystore).

const mem = new Map<string, string>();

export const secretsPersist = false;

export async function getSecret(name: string): Promise<string | null> {
  return mem.get(name) ?? null;
}

export async function setSecret(name: string, value: string): Promise<void> {
  mem.set(name, value);
}

export async function deleteSecret(name: string): Promise<void> {
  mem.delete(name);
}
