// Web version: keys are kept in this browser's storage, unencrypted, so they survive a
// reload. Chosen knowingly for the web version (see README). Falls back to memory when
// storage is blocked, for example in a private window.

const PREFIX = 'dagsljus.secret.';
const mem = new Map<string, string>();

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const secretsPersist = (() => {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(`${PREFIX}probe`, '1');
    s.removeItem(`${PREFIX}probe`);
    return true;
  } catch {
    return false;
  }
})();

export async function getSecret(name: string): Promise<string | null> {
  try {
    return storage()?.getItem(PREFIX + name) ?? mem.get(name) ?? null;
  } catch {
    return mem.get(name) ?? null;
  }
}

export async function setSecret(name: string, value: string): Promise<void> {
  mem.set(name, value);
  try {
    storage()?.setItem(PREFIX + name, value);
  } catch {
    /* memory only */
  }
}

export async function deleteSecret(name: string): Promise<void> {
  mem.delete(name);
  try {
    storage()?.removeItem(PREFIX + name);
  } catch {
    /* nothing stored */
  }
}
