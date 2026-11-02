// The keys to the model and Garmin: on the phone and in the browser-only preview they stay on
// the device; in the web version with Firebase they follow the account inside the encrypted
// store, and never leave in an export.

import { memoryBackend, type DocBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import { deleteKey, getKey, keysSync, setKey, syncedKeyDoc, SYNCED_KEYS } from '../src/services/keys';
import { cloudBackend, memoryCloudDocs } from '../src/storage/cloudBackend';
import { createVault } from '../src/cloud/vault';
import { webcrypto } from 'crypto';
import { getSecret, setSecret } from '../src/platform/secrets';
import { LLM_KEY_NAME, llmStatus } from '../src/services/llm';
import { GARMIN_KEY_NAME } from '../src/services/garmin';
import { destinationKey } from '../src/llm/config';

jest.mock('../src/platform/secrets', () => {
  const mem = new Map<string, string>();
  return { secretsPersist: false, getSecret: async (n: string) => mem.get(n) ?? null, setSecret: async (n: string, v: string) => void mem.set(n, v), deleteSecret: async (n: string) => void mem.delete(n) };
});

/** A backend that reports itself as the encrypted Firebase store, sharing data like two devices on one account. */
function cloud(shared: DocBackend): DocBackend {
  return { ...shared, info: () => ({ kind: 'cloud', encrypted: true, detail: 'test' }) };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('Nycklarna', () => {
  it('stay on the device when the storage is not the encrypted cloud', async () => {
    const repo = await Repository.create(memoryBackend());
    expect(keysSync(repo)).toBe(false);
    await setKey(repo, LLM_KEY_NAME, 'mk-local');
    expect(await getSecret(LLM_KEY_NAME)).toBe('mk-local');
    expect(repo.kvGet(SYNCED_KEYS)).toBeUndefined();
    await deleteKey(repo, LLM_KEY_NAME);
  });

  it('follow the account in the encrypted cloud: typed on one device, there on the next', async () => {
    const shared = memoryBackend();
    const laptop = await Repository.create(cloud(shared));
    expect(keysSync(laptop)).toBe(true);
    await setKey(laptop, LLM_KEY_NAME, 'mk-1');
    await setKey(laptop, GARMIN_KEY_NAME, 'gk-1');
    // No plain copy is left in the browser's storage.
    expect(await getSecret(LLM_KEY_NAME)).toBeNull();
    const phone = await Repository.create(cloud(shared));
    expect(await getKey(phone, LLM_KEY_NAME)).toBe('mk-1');
    expect(await getKey(phone, GARMIN_KEY_NAME)).toBe('gk-1');
    await phone.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest', consentFor: destinationKey('mistral', '') });
    expect((await llmStatus(phone)).ready).toBe(true);
    await deleteKey(phone, GARMIN_KEY_NAME);
    expect(await getKey(await Repository.create(cloud(shared)), GARMIN_KEY_NAME)).toBeNull();
  });

  it('moves a key typed in this browser before into the encrypted store', async () => {
    await setSecret(LLM_KEY_NAME, 'mk-old');
    const repo = await Repository.create(cloud(memoryBackend()));
    expect(await getKey(repo, LLM_KEY_NAME)).toBe('mk-old');
    expect(repo.kvGet(syncedKeyDoc(LLM_KEY_NAME))).toBe('mk-old');
    expect(await getSecret(LLM_KEY_NAME)).toBeNull();
  });

  it('moves a key from the earlier shared map into its own document', async () => {
    const shared = memoryBackend();
    await shared.put('kv', SYNCED_KEYS, { [LLM_KEY_NAME]: 'mk-map' });
    const repo = await Repository.create(cloud(shared));
    expect(await getKey(repo, LLM_KEY_NAME)).toBe('mk-map');
    expect(repo.kvGet(syncedKeyDoc(LLM_KEY_NAME))).toBe('mk-map');
    await deleteKey(repo, LLM_KEY_NAME);
    expect(await getKey(await Repository.create(cloud(shared)), LLM_KEY_NAME)).toBeNull();
  });

  it('a tab opened earlier sees a key saved on another device since, and does not overwrite it', async () => {
    const shared = memoryBackend();
    // The laptop tab is opened first and stays open.
    const laptop = await Repository.create(cloud(shared));
    const phone = await Repository.create(cloud(shared));
    await setKey(phone, LLM_KEY_NAME, 'mk-phone');
    // The old tab saves its Garmin key: before, this wrote the whole map from its stale copy.
    await setKey(laptop, GARMIN_KEY_NAME, 'gk-laptop');
    expect(await getKey(laptop, LLM_KEY_NAME)).toBe('mk-phone');
    const third = await Repository.create(cloud(shared));
    expect(await getKey(third, LLM_KEY_NAME)).toBe('mk-phone');
    expect(await getKey(third, GARMIN_KEY_NAME)).toBe('gk-laptop');
    await phone.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest', consentFor: destinationKey('mistral', '') });
    const again = await Repository.create(cloud(shared));
    expect((await llmStatus(again)).ready).toBe(true);
  });

  it('works through the real encrypted Firebase store, between two browsers', async () => {
    const docs = memoryCloudDocs();
    const crypto = webcrypto as unknown as Crypto;
    const { vault } = await createVault('ett långt lösenord', { crypto: crypto as never, iterations: 1000 });
    const open = () => Repository.create(cloudBackend(docs, { account: 'test', vault }));
    const first = await open();
    const second = await open();
    expect(keysSync(first)).toBe(true);
    await setKey(first, LLM_KEY_NAME, 'mk-sealed');
    // On its way to Firebase, the browser's own copy counts.
    expect(await getKey(first, LLM_KEY_NAME)).toBe('mk-sealed');
    // The write is encrypted and sent in the background, as in the browser.
    await settle();
    // Nothing readable reaches Firebase.
    expect(JSON.stringify([...docs.store.values()])).not.toContain('mk-sealed');
    expect(await getKey(second, LLM_KEY_NAME)).toBe('mk-sealed');
    // A new key on the second browser reaches the first, which saved the old one itself.
    await setKey(second, LLM_KEY_NAME, 'mk-new');
    await settle();
    expect(await getKey(first, LLM_KEY_NAME)).toBe('mk-new');
    await deleteKey(second, LLM_KEY_NAME);
    await settle();
    expect(await getKey(await open(), LLM_KEY_NAME)).toBeNull();
  });

  it('never leave in an export, and an import does not remove them', async () => {
    const repo = await Repository.create(cloud(memoryBackend()));
    await setKey(repo, LLM_KEY_NAME, 'mk-x');
    const file = repo.exportData();
    expect(JSON.stringify(file)).not.toContain('mk-x');
    await repo.importData({ ...file, data: { ...file.data, kv: { ...file.data.kv, [SYNCED_KEYS]: { [LLM_KEY_NAME]: 'injected' }, [syncedKeyDoc(LLM_KEY_NAME)]: 'injected' } } });
    expect(await getKey(repo, LLM_KEY_NAME)).toBe('mk-x');
  });
});
