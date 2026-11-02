import { webcrypto } from 'crypto';
import {
  createVault, openVault, VAULT_DOC_ID, VAULT_ITERATIONS, WrongPasswordError, type CryptoLike,
} from '../src/cloud/vault';
import { emptySnapshot } from '../src/storage/backend';
import {
  cloudBackend, docId, encryptExisting, isPlainDoc, isSealedDoc, memoryCloudDocs, type StoredDoc,
} from '../src/storage/cloudBackend';
import { Repository } from '../src/storage/repository';
import { commitVault, prepareVault, readVaultState, unlockVault } from '../src/services/vaultFlow';

// Node's Web Crypto: the same API the browser has.
const crypto = webcrypto as unknown as CryptoLike;
// Fewer iterations keep the tests fast; one test checks the real figure.
const FAST = { crypto, iterations: 1000 };
const PW = 'en lång mening som lösenord';

/** Plain documents as the web version stored them before encryption. */
function plainRows() {
  const at = '2026-10-31T10:00:00.000Z';
  const doc = (c: 'entries' | 'grund' | 'assessments' | 'kv', i: string, v: unknown): { id: string; data: StoredDoc } =>
    ({ id: docId(c, i), data: { c, i, j: JSON.stringify(v), u: at } });
  return [
    doc('entries', 'e_2026-10-30', { id: 'e_2026-10-30', date: '2026-10-30', transcript: 'Orkade inte svara på sms i dag.', mood: 0 }),
    doc('grund', 'p1', { id: 'p1', kind: 'serious', text: 'Slutar äta', nested: [[1, 2], [3]] }),
    doc('assessments', 'a1', { id: 'a1', level: 'yellow', points: 1, sentence: 'Det tydligaste i dag liknar ditt tecken.' }),
    doc('kv', 'settings', { reminder: '21:00', scrubNames: ['Kim'] }),
  ];
}

describe('the key from the password', () => {
  it('uses PBKDF2-SHA256 with 600 000 iterations and AES-256-GCM, and opens only with the right password', async () => {
    expect(VAULT_ITERATIONS).toBe(600_000);
    const { header } = await createVault(PW, { crypto });
    expect(header.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 });
    expect(header.cipher).toBe('AES-256-GCM');
    // The header holds no password and nothing derived that opens the data without it.
    expect(JSON.stringify(header)).not.toContain(PW);
    await expect(openVault(PW, header, { crypto })).resolves.toBeTruthy();
    await expect(openVault('fel lösenord helt och hållet', header, { crypto })).rejects.toBeInstanceOf(WrongPasswordError);
  }, 30_000);

  it('refuses a password shorter than 10 characters', async () => {
    await expect(createVault('kort', FAST)).rejects.toThrow('minst 10 tecken');
  });

  it('a new salt each time: the same password gives different keys and document ids', async () => {
    const a = await createVault(PW, FAST);
    const b = await createVault(PW, FAST);
    expect(a.header.kdf.salt).not.toBe(b.header.kdf.salt);
    expect(await a.vault.docIdFor('entries~e1')).not.toBe(await b.vault.docIdFor('entries~e1'));
  });
});

describe('encrypted storage in Firebase', () => {
  it('stores only ciphertext under opaque ids, and loads it back', async () => {
    const docs = memoryCloudDocs();
    const { vault } = await createVault(PW, FAST);
    const backend = cloudBackend(docs, { account: 'test@example.com', vault });
    await backend.put('entries', 'e_2026-10-30', { transcript: 'Orkade inte svara på sms i dag.', date: '2026-10-30' });
    await backend.put('grund', 'p1', { text: 'Slutar äta' });
    const loaded = await backend.load();
    expect(loaded.entries['e_2026-10-30']).toEqual({ transcript: 'Orkade inte svara på sms i dag.', date: '2026-10-30' });
    const raw = JSON.stringify(Array.from(docs.store));
    for (const secret of ['Orkade', 'sms', 'Slutar', 'entries', 'grund', '2026-10-30']) expect(raw).not.toContain(secret);
    expect(Array.from(docs.store.keys()).every((id) => /^x[A-Za-z0-9_-]{43}$/.test(id))).toBe(true);
    expect(backend.info()).toMatchObject({ kind: 'cloud', encrypted: true });
  });

  it('keeps the order of quick writes to the same item, and removes by the opaque id', async () => {
    const docs = memoryCloudDocs();
    const { vault } = await createVault(PW, FAST);
    const backend = cloudBackend(docs, { account: 'a', vault });
    for (let n = 1; n <= 5; n++) await backend.put('kv', 'settings', { n });
    expect((await backend.load()).kv.settings).toEqual({ n: 5 });
    await backend.remove('kv', 'settings');
    expect((await backend.load()).kv).toEqual({});
    expect(docs.store.size).toBe(0);
  });

  it('an item moved to another document id does not open', async () => {
    const docs = memoryCloudDocs();
    const { vault } = await createVault(PW, FAST);
    const backend = cloudBackend(docs, { account: 'a', vault });
    await backend.put('kv', 'a', { x: 1 });
    await backend.load();
    const [[id, data]] = Array.from(docs.store);
    docs.store.delete(id);
    docs.store.set('xmoved', data);
    await expect(backend.load()).rejects.toThrow('gick inte att låsa upp');
  });

  it('import keeps the password record, deleting everything removes it', async () => {
    const docs = memoryCloudDocs();
    const { vault, header } = await createVault(PW, FAST);
    await docs.set(VAULT_DOC_ID, header);
    const backend = cloudBackend(docs, { account: 'a', vault });
    const snap = emptySnapshot();
    snap.entries.e1 = { id: 'e1' };
    await backend.replaceAll(snap);
    expect(docs.store.has(VAULT_DOC_ID)).toBe(true);
    expect((await backend.load()).entries.e1).toEqual({ id: 'e1' });
    await backend.wipe();
    expect(docs.store.size).toBe(0);
  });

  it('the repository works on top of it, and a second session with the password sees the same data', async () => {
    const docs = memoryCloudDocs();
    const { vault, header } = await createVault(PW, FAST);
    await docs.set(VAULT_DOC_ID, header);
    const backend = cloudBackend(docs, { account: 'a', vault });
    const repo = await Repository.create(backend);
    await repo.addContextEntry({ kind: 'trigger', text: 'Resor över tidszoner', origin: 'user' });
    // load() waits for this backend's queued, encrypted writes.
    await backend.load();
    const again = await openVault(PW, header, { crypto });
    const repo2 = await Repository.create(cloudBackend(docs, { account: 'a', vault: again }));
    expect(repo2.contextOf('trigger').map((e) => e.text)).toEqual(['Resor över tidszoner']);
  });
});

describe('encrypting data stored before', () => {
  it('a trial run works on a copy and leaves Firebase untouched', async () => {
    const docs = memoryCloudDocs(plainRows());
    const before = JSON.stringify(Array.from(docs.store));
    const { vault } = await createVault(PW, FAST);
    const r = await encryptExisting(docs, vault, { trial: true });
    expect(r).toMatchObject({ found: 4, verified: 4, removed: 0, ok: true, problem: null });
    expect(r.perCollection).toEqual({ entries: 1, grund: 1, assessments: 1, kv: 1 });
    expect(JSON.stringify(Array.from(docs.store))).toBe(before);
  });

  it('the real run writes encrypted copies, checks every one, then removes the originals', async () => {
    const docs = memoryCloudDocs(plainRows());
    const { vault } = await createVault(PW, FAST);
    const r = await encryptExisting(docs, vault);
    expect(r).toMatchObject({ found: 4, verified: 4, removed: 4, ok: true });
    const stored = Array.from(docs.store.values());
    expect(stored.some(isPlainDoc)).toBe(false);
    expect(stored.filter(isSealedDoc)).toHaveLength(4);
    const loaded = await cloudBackend(docs, { account: 'a', vault }).load();
    expect(loaded.grund.p1).toEqual({ id: 'p1', kind: 'serious', text: 'Slutar äta', nested: [[1, 2], [3]] });
    expect(loaded.kv.settings).toEqual({ reminder: '21:00', scrubNames: ['Kim'] });
    // Running it again finds nothing left to do.
    expect(await encryptExisting(docs, vault)).toMatchObject({ found: 0, ok: true });
  });

  it('when a copy does not match, the copies are removed and the originals stay', async () => {
    const docs = memoryCloudDocs(plainRows());
    const { vault } = await createVault(PW, FAST);
    let n = 0;
    const faulty = { ...vault, async open(id: string, s: Parameters<typeof vault.open>[1]) { const t = await vault.open(id, s); return ++n === 2 ? t.replace('Slutar', 'Börjar') : t; } };
    const r = await encryptExisting(docs, faulty);
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('orörda');
    expect(JSON.stringify(Array.from(docs.store))).toBe(JSON.stringify(Array.from(memoryCloudDocs(plainRows()).store)));
  });

  it('stops before writing when an original cannot be read', async () => {
    const rows = plainRows();
    (rows[0].data as { j: string }).j = '{trasig';
    const docs = memoryCloudDocs(rows);
    const { vault } = await createVault(PW, FAST);
    const r = await encryptExisting(docs, vault);
    expect(r).toMatchObject({ ok: false, verified: 0 });
    expect(docs.store.size).toBe(4);
  });
});

describe('the password screen\'s steps', () => {
  it('first time with old data: trial on a copy, then the header first and the real run', async () => {
    const docs = memoryCloudDocs(plainRows());
    expect(await readVaultState(docs)).toEqual({ header: null, plain: 4 });
    const prepared = await prepareVault(docs, PW, FAST);
    expect(prepared.trial).toMatchObject({ found: 4, ok: true });
    expect(docs.store.has(VAULT_DOC_ID)).toBe(false);
    const report = await commitVault(docs, prepared);
    expect(report).toMatchObject({ removed: 4, ok: true });
    expect(await readVaultState(docs)).toMatchObject({ plain: 0 });
    expect((await readVaultState(docs)).header?.kdf.iterations).toBe(1000);
  });

  it('a new user without data gets the header and nothing else', async () => {
    const docs = memoryCloudDocs();
    const prepared = await prepareVault(docs, PW, FAST);
    expect(prepared.trial).toBeNull();
    expect(await commitVault(docs, prepared)).toBeNull();
    expect(Array.from(docs.store.keys())).toEqual([VAULT_DOC_ID]);
  });

  it('will not replace an existing password record', async () => {
    const docs = memoryCloudDocs();
    await commitVault(docs, await prepareVault(docs, PW, FAST));
    await expect(commitVault(docs, await prepareVault(docs, 'ett annat långt lösenord', FAST))).rejects.toThrow('redan ett lösenord');
  });

  it('unlocking with the wrong password fails; the right one finishes an interrupted migration', async () => {
    const docs = memoryCloudDocs(plainRows());
    const prepared = await prepareVault(docs, PW, FAST);
    // Interrupted: the header was stored but the real run never happened.
    await docs.set(VAULT_DOC_ID, prepared.header);
    const { header } = await readVaultState(docs);
    await expect(unlockVault(docs, header!, 'fel lösenord helt och hållet', { crypto })).rejects.toBeInstanceOf(WrongPasswordError);
    const { report } = await unlockVault(docs, header!, PW, { crypto });
    expect(report).toMatchObject({ found: 4, removed: 4, ok: true });
    expect((await readVaultState(docs)).plain).toBe(0);
  });
});
