import { decryptBackup, encryptBackup, fromBase64, toBase64, utf8Decode, utf8Encode } from '../src/backup/crypto';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import type { Assessment, Entry } from '../src/core/domain/types';

let seed = 1;
const rnd = (n: number) => Uint8Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) & 0xff));

describe('backup encryption', () => {
  it('base64 round-trips', () => {
    for (const len of [0, 1, 2, 3, 4, 31, 32, 33]) {
      const b = rnd(len);
      expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b));
    }
    expect(toBase64(new TextEncoder().encode('hej'))).toBe('aGVq');
  });

  it('utf-8 round-trips Swedish letters and emoji', () => {
    const s = 'Åsa sov 4 h 😴 – ok';
    expect(utf8Decode(utf8Encode(s))).toBe(s);
    expect(Array.from(utf8Encode('å'))).toEqual([0xc3, 0xa5]);
  });

  it('encrypts and decrypts with the right password only', async () => {
    const file = await encryptBackup('{"å":"ä"}', 'hemligt lösen', rnd, 1000);
    expect(file.data).not.toContain('å');
    expect(await decryptBackup(file, 'hemligt lösen')).toBe('{"å":"ä"}');
    await expect(decryptBackup(file, 'fel lösen!')).rejects.toThrow('Fel lösenord');
  });

  it('refuses short passwords', async () => {
    await expect(encryptBackup('x', 'kort', rnd, 1000)).rejects.toThrow('minst 8');
  });
});

function entry(id: string, date: string): Entry {
  return {
    id, date, createdAt: `${date}T21:00:00.000Z`, kind: 'checkin', transcript: 'x',
    mood: 5, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null,
  };
}
function assessment(id: string, e: Entry): Assessment {
  return {
    id, entryId: e.id, date: e.date, createdAt: e.createdAt, level: 'green', points: 0, signals: [],
    sentence: '', method: 'wordmatch', model: null, promptId: null, promptVersion: null,
    baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 },
  };
}

describe('repository', () => {
  it('a new entry for the same evening replaces the old one and its assessment', async () => {
    const repo = await Repository.create(memoryBackend());
    const a = entry('a', '2026-10-20');
    const b = entry('b', '2026-10-20');
    await repo.saveEntry(a, assessment('x', a));
    await repo.saveEntry(b, assessment('y', b));
    expect(repo.entries().map((e) => e.id)).toEqual(['b']);
    expect(repo.assessments().map((x) => x.id)).toEqual(['y']);
  });

  it('keeps plan order per category and moves items', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addPlanItems([
      { id: '1', kind: 'action_red', text: 'Första' },
      { id: '2', kind: 'action_red', text: 'Andra' },
    ]);
    expect(repo.planOf('action_red').map((p) => p.text)).toEqual(['Första', 'Andra']);
    await repo.movePlanItem('2', -1);
    expect(repo.planOf('action_red').map((p) => p.text)).toEqual(['Andra', 'Första']);
  });

  it('export, wipe and import restore everything', async () => {
    const backend = memoryBackend();
    const repo = await Repository.create(backend);
    await repo.updateSettings({ scrubNames: ['Kim'] });
    await repo.addPlanItems([{ id: 'p', kind: 'early', text: 'Sover mindre' }]);
    const e = entry('e', '2026-10-20');
    await repo.saveEntry(e, assessment('a', e));
    const exported = repo.exportData();

    await repo.wipe();
    expect(repo.entries()).toEqual([]);
    expect(repo.plan()).toEqual([]);
    expect(repo.settings().scrubNames).toEqual([]);

    await repo.importData(JSON.parse(JSON.stringify(exported)));
    expect(repo.entries().map((x) => x.id)).toEqual(['e']);
    expect(repo.plan().map((x) => x.text)).toEqual(['Sover mindre']);
    expect(repo.settings().scrubNames).toEqual(['Kim']);
  });

  it('rejects files that are not exports', async () => {
    const repo = await Repository.create(memoryBackend());
    await expect(repo.importData({ format: 'annat' } as any)).rejects.toThrow('inte en Dagsljus-export');
  });
});
