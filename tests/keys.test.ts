// The keys to the model and Garmin: on the phone and in the browser-only preview they stay on
// the device; in the web version with Firebase they follow the account inside the encrypted
// store, and never leave in an export.

import { memoryBackend, type DocBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import { deleteKey, getKey, keysSync, setKey, SYNCED_KEYS } from '../src/services/keys';
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
    expect(repo.kvGet(SYNCED_KEYS)).toEqual({ [LLM_KEY_NAME]: 'mk-old' });
    expect(await getSecret(LLM_KEY_NAME)).toBeNull();
  });

  it('never leave in an export, and an import does not remove them', async () => {
    const repo = await Repository.create(cloud(memoryBackend()));
    await setKey(repo, LLM_KEY_NAME, 'mk-x');
    const file = repo.exportData();
    expect(JSON.stringify(file)).not.toContain('mk-x');
    await repo.importData({ ...file, data: { ...file.data, kv: { ...file.data.kv, [SYNCED_KEYS]: { [LLM_KEY_NAME]: 'injected' } } } });
    expect(await getKey(repo, LLM_KEY_NAME)).toBe('mk-x');
  });
});
