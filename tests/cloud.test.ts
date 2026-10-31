import { parseFirebaseConfig } from '../src/cloud/config';
import { authErrorText } from '../src/cloud/errors';
import { adoptLocalData, cloudBackend, docId, type CloudDoc, type CloudDocs } from '../src/storage/cloudBackend';
import { emptySnapshot } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const CONSOLE_SNIPPET = `const firebaseConfig = {
  apiKey: "AIzaSyExample",
  authDomain: "dagsljus-123.firebaseapp.com",
  projectId: "dagsljus-123",
  storageBucket: "dagsljus-123.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
  measurementId: "G-XXXX"
};`;

describe('Firebase config', () => {
  it('reads the snippet exactly as the Firebase console shows it', () => {
    expect(parseFirebaseConfig(CONSOLE_SNIPPET)).toEqual({
      apiKey: 'AIzaSyExample', authDomain: 'dagsljus-123.firebaseapp.com', projectId: 'dagsljus-123',
      storageBucket: 'dagsljus-123.firebasestorage.app', messagingSenderId: '1234567890', appId: '1:1234567890:web:abcdef',
    });
  });

  it('reads plain JSON, and gives null when something required is missing', () => {
    expect(parseFirebaseConfig('{"apiKey":"a","authDomain":"b","projectId":"c","appId":"d"}')?.projectId).toBe('c');
    expect(parseFirebaseConfig('{"apiKey":"a"}')).toBeNull();
    expect(parseFirebaseConfig(undefined)).toBeNull();
    expect(parseFirebaseConfig('  ')).toBeNull();
  });
});

function fakeDocs(failWrites = false): CloudDocs & { store: Map<string, CloudDoc>; commits: number } {
  const store = new Map<string, CloudDoc>();
  const f = {
    store,
    commits: 0,
    async list() {
      return Array.from(store, ([id, data]) => ({ id, data }));
    },
    async set(id: string, data: CloudDoc) {
      if (failWrites) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
      store.set(id, data);
    },
    async remove(id: string) {
      store.delete(id);
    },
    async commit(ops: Parameters<CloudDocs['commit']>[0]) {
      f.commits++;
      for (const op of ops) {
        if (op.type === 'set') store.set(op.id, op.data);
        else store.delete(op.id);
      }
    },
  };
  return f;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('cloud storage', () => {
  it('stores each item as JSON text under its own id and loads it back', async () => {
    const docs = fakeDocs();
    const backend = cloudBackend(docs, { account: 'a@b.se', now: () => new Date('2026-10-31T10:00:00Z') });
    const repo = await Repository.create(backend);
    await repo.addPlanItems([{ id: 'p/1', kind: 'early', text: 'Svarar inte på sms' }]);
    await repo.saveGarminDays([{ date: '2026-10-31', sleepHours: 6, deepMinutes: null, remMinutes: null, sleepStart: '23:00', sleepEnd: '05:00', stressAvg: 30, stressHighMinutes: 5, bodyBatteryWake: null, fetchedAt: '' }], '2026-10-31');
    await flush();
    expect(docs.store.get(docId('plan', 'p/1'))).toMatchObject({ c: 'plan', i: 'p/1', u: '2026-10-31T10:00:00.000Z' });
    expect(docId('plan', 'p/1')).toBe('plan~p%2F1');
    const again = await Repository.create(cloudBackend(docs, { account: 'a@b.se' }));
    expect(again.plan()[0].text).toBe('Svarar inte på sms');
    expect(again.garminDay('2026-10-31')?.sleepHours).toBe(6);
    expect(again.storageInfo()).toMatchObject({ kind: 'cloud', encrypted: false });
    expect(again.storageInfo().detail).toContain('a@b.se');
  });

  it('wipes and replaces everything in batches', async () => {
    const docs = fakeDocs();
    const repo = await Repository.create(cloudBackend(docs, { account: 'x' }));
    await repo.updateSettings({ scrubNames: ['Kim'] });
    await flush();
    const exported = repo.exportData();
    await repo.wipe();
    expect(docs.store.size).toBe(0);
    await repo.importData(exported);
    expect(repo.settings().scrubNames).toEqual(['Kim']);
    expect(docs.commits).toBe(2);
  });

  it('says so when Firebase refuses a write', async () => {
    const errors: string[] = [];
    const backend = cloudBackend(fakeDocs(true), { account: 'x', onError: (m) => errors.push(m) });
    await backend.put('kv', 'settings', {});
    await flush();
    expect(errors[0]).toContain('reglerna för Firestore');
    expect(backend.info().detail).toContain('reglerna för Firestore');
  });

  it('moves browser-only data into an empty cloud store once', async () => {
    const docs = fakeDocs();
    const backend = cloudBackend(docs, { account: 'x' });
    const local = emptySnapshot();
    local.kv.settings = { scrubNames: ['Robin'] };
    expect(await adoptLocalData(backend, local)).toBe(true);
    expect(await adoptLocalData(backend, { ...emptySnapshot(), kv: { other: 1 } })).toBe(false);
    expect((await backend.load()).kv.settings).toEqual({ scrubNames: ['Robin'] });
    expect(await adoptLocalData(cloudBackend(fakeDocs(), { account: 'x' }), emptySnapshot())).toBe(false);
  });
});

describe('sign-in errors', () => {
  it('explains the common Firebase errors in Swedish', () => {
    expect(authErrorText({ code: 'auth/invalid-credential' })).toBe('Fel e-post eller lösenord.');
    expect(authErrorText({ code: 'auth/operation-not-allowed' })).toContain('Authentication');
    expect(authErrorText({ code: 'auth/user-not-found' })).toBe('Fel e-post eller lösenord.');
    expect(authErrorText(new Error('x'))).toBe('Inloggningen misslyckades. Försök igen.');
  });
});
