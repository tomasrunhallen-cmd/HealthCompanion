// The keys to the language model and Garmin. On the phone they stay in Keychain / Keystore. In
// the web version with Firebase they are kept with the rest of the data instead, encrypted in
// the browser with the key from the person's password before they reach Firebase, so they
// follow the account to every device and browser. They are never part of an export.

import { deleteSecret, getSecret, setSecret } from '../platform/secrets';
import { SYNCED_KEYS, type Repository } from '../storage/repository';

export { SYNCED_KEYS };

/** True when keys follow the account: the encrypted Firebase store of the web version. */
export function keysSync(repo: Repository): boolean {
  const info = repo.storageInfo();
  return info.kind === 'cloud' && info.encrypted === true;
}

function synced(repo: Repository): Record<string, string> {
  return (repo.kvGet(SYNCED_KEYS) as Record<string, string> | null | undefined) ?? {};
}

export async function getKey(repo: Repository, name: string): Promise<string | null> {
  if (!keysSync(repo)) return getSecret(name);
  const stored = synced(repo)[name];
  if (stored) return stored;
  // A key typed on this browser before keys followed the account: move it into the encrypted store.
  const local = await getSecret(name);
  if (local) await setKey(repo, name, local);
  return local;
}

export async function setKey(repo: Repository, name: string, value: string): Promise<void> {
  if (!keysSync(repo)) return setSecret(name, value);
  await repo.kvSet(SYNCED_KEYS, { ...synced(repo), [name]: value });
  // No plain copy left in the browser's storage.
  await deleteSecret(name);
}

export async function deleteKey(repo: Repository, name: string): Promise<void> {
  await deleteSecret(name);
  if (!keysSync(repo)) return;
  const { [name]: _gone, ...rest } = synced(repo);
  void _gone;
  await repo.kvSet(SYNCED_KEYS, rest);
}
