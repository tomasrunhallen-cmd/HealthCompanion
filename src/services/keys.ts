// The keys to the language model and Garmin. On the phone they stay in Keychain / Keystore. In
// the web version with Firebase they are kept with the rest of the data instead, encrypted in
// the browser with the key from the person's password before they reach Firebase, so they
// follow the account to every device and browser. They are never part of an export.
//
// Each key is its own document and is read afresh from Firebase: a browser tab that was opened
// earlier must neither miss a key saved on another device since, nor overwrite it.

import { deleteSecret, getSecret, setSecret } from '../platform/secrets';
import { SYNCED_KEY_PREFIX, SYNCED_KEYS, type Repository } from '../storage/repository';

export { SYNCED_KEYS };

export const syncedKeyDoc = (name: string) => `${SYNCED_KEY_PREFIX}${name}`;

/** True when keys follow the account: the encrypted Firebase store of the web version. */
export function keysSync(repo: Repository): boolean {
  const info = repo.storageInfo();
  return info.kind === 'cloud' && info.encrypted === true;
}

export async function getKey(repo: Repository, name: string): Promise<string | null> {
  if (!keysSync(repo)) return getSecret(name);
  const own = await repo.kvFetch(syncedKeyDoc(name));
  if (typeof own === 'string' && own) return own;
  // Before keys had their own documents they shared one map; after that, a key typed in this
  // browser before keys followed the account. Either is moved into its own document.
  const map = (await repo.kvFetch(SYNCED_KEYS)) as Record<string, string> | null | undefined;
  const earlier = map?.[name] || (await getSecret(name));
  if (earlier) await setKey(repo, name, earlier);
  return earlier || null;
}

export async function setKey(repo: Repository, name: string, value: string): Promise<void> {
  if (!keysSync(repo)) return setSecret(name, value);
  await repo.kvSet(syncedKeyDoc(name), value);
  // No plain copy left in the browser's storage.
  await deleteSecret(name);
}

export async function deleteKey(repo: Repository, name: string): Promise<void> {
  await deleteSecret(name);
  if (!keysSync(repo)) return;
  await repo.kvRemove(syncedKeyDoc(name));
  const map = (await repo.kvFetch(SYNCED_KEYS)) as Record<string, string> | null | undefined;
  if (map && name in map) {
    const { [name]: _gone, ...rest } = map;
    void _gone;
    if (Object.keys(rest).length) await repo.kvSet(SYNCED_KEYS, rest);
    else await repo.kvRemove(SYNCED_KEYS);
  }
}
