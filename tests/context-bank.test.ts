import { emptySnapshot, memoryBackend } from '../src/storage/backend';
import { Repository, SCHEMA_VERSION } from '../src/storage/repository';

function oldSnapshot() {
  const s = emptySnapshot();
  s.plan = {
    p1: { id: 'p1', kind: 'early', text: 'Svarar inte på sms', order: 0, approvedAt: '2026-10-01T10:00:00.000Z' },
    p2: { id: 'p2', kind: 'action_red', text: 'Ring mottagningen', order: 0, approvedAt: '2026-10-01T10:00:00.000Z' },
  };
  s.kv.planSettings = { normalState: 'Sover sju timmar, jobbar dagtid', sleepThresholdHours: 6 };
  s.kv.settings = { scrubNames: ['Kim'] };
  return s;
}

describe('context bank migration', () => {
  it('moves the crisis plan into grund and the normal state into profil', async () => {
    const backend = memoryBackend(oldSnapshot());
    const repo = await Repository.create(backend);
    const grund = repo.contextEntries('grund');
    expect(grund.map((e) => [e.id, e.kind, e.origin, e.approvedAt])).toEqual([
      ['p2', 'action_red', 'crisis_plan', '2026-10-01T10:00:00.000Z'],
      ['p1', 'early', 'crisis_plan', '2026-10-01T10:00:00.000Z'],
    ]);
    expect(repo.contextEntries('profil')).toEqual([expect.objectContaining({ kind: 'normal_state', text: 'Sover sju timmar, jobbar dagtid', origin: 'user' })]);
    expect(repo.planSettings()).toEqual({ normalState: 'Sover sju timmar, jobbar dagtid', sleepThresholdHours: 6 });
    expect(repo.plan().map((p) => p.text)).toEqual(['Ring mottagningen', 'Svarar inte på sms']);
    expect(repo.settings()).toMatchObject({ contextMode: 'own', scrubNames: ['Kim'] });

    const stored = await backend.load();
    expect(stored.plan).toEqual({});
    expect(stored.kv.planSettings).toEqual({ sleepThresholdHours: 6 });
    expect(stored.kv.schemaVersion).toBe(SCHEMA_VERSION);

    // Running again changes nothing.
    const again = await Repository.create(backend);
    expect(again.contextEntries()).toEqual(repo.contextEntries());
  });

  it('migrates an old export on import', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.importData({ format: 'dagsljus-export', version: 1, exportedAt: '2026-10-01', data: oldSnapshot() });
    expect(repo.plan()).toHaveLength(2);
    expect(repo.planSettings().normalState).toBe('Sover sju timmar, jobbar dagtid');
  });

  it('a new install starts unset and empty', async () => {
    const repo = await Repository.create(memoryBackend());
    expect(repo.settings().contextMode).toBe('unset');
    expect(repo.contextEntries()).toEqual([]);
  });
});

describe('context bank entries', () => {
  it('adds, edits, orders and removes entries in their own layer', async () => {
    const repo = await Repository.create(memoryBackend());
    const a = await repo.addContextEntry({ kind: 'trigger', text: 'Långa resor', origin: 'user' });
    const b = await repo.addContextEntry({ kind: 'trigger', text: 'Sömnbrist', origin: 'user' });
    const ev = await repo.addContextEntry({ kind: 'event', text: 'Resa till Umeå', origin: 'user', date: '2026-11-10' });
    expect([a.layer, ev.layer]).toEqual(['grund', 'dagligt']);
    expect(repo.contextOf('trigger').map((e) => e.text)).toEqual(['Långa resor', 'Sömnbrist']);
    await repo.moveContextEntry(b.id, -1);
    expect(repo.contextOf('trigger').map((e) => e.text)).toEqual(['Sömnbrist', 'Långa resor']);
    await repo.updateContextEntry(a.id, { text: 'Resor över tidszoner' });
    await repo.removeContextEntry(ev.id);
    expect(repo.contextEntries('dagligt')).toEqual([]);
    await expect(repo.updateContextEntry(a.id, { kind: 'event' })).rejects.toThrow('mellan lager');
  });

  it('standard rows start unconfirmed and become the user\'s own when edited', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addPlanItems([{ id: 's1', kind: 'early', text: 'Sover mycket mindre' }], 'standard');
    expect(repo.plan()[0]).toMatchObject({ origin: 'standard', approvedAt: null });
    await repo.updatePlanItem('s1', 'Sover under fem timmar');
    expect(repo.plan()[0]).toMatchObject({ origin: 'user', text: 'Sover under fem timmar', approvedAt: expect.any(String) });
  });

  it('saving the normal state replaces the profil entry', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.updatePlanSettings({ normalState: 'Lugn' });
    await repo.updatePlanSettings({ normalState: 'Lugn och glad' });
    expect(repo.contextOf('normal_state').map((e) => e.text)).toEqual(['Lugn och glad']);
    await repo.updatePlanSettings({ normalState: '' });
    expect(repo.contextOf('normal_state')).toEqual([]);
  });
});

describe('medication in the check-in', () => {
  it('stores one answer per evening in dagligt and tells the model', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveCheckin } = require('../src/services/checkin');
    const repo = await Repository.create(memoryBackend());
    await repo.addContextEntry({ kind: 'medication', text: 'Litium 600 mg', origin: 'user' });
    const now = new Date(2026, 10, 1, 21, 0);
    await saveCheckin(repo, { transcript: 'Vanlig dag.', mood: 5, energy: 5, wordsPerMinute: null, medicationTaken: true }, now);
    await saveCheckin(repo, { transcript: 'Vanlig dag.', mood: 5, energy: 5, wordsPerMinute: null, medicationTaken: false }, now);
    expect(repo.contextOf('medication_taken')).toEqual([expect.objectContaining({ layer: 'dagligt', date: '2026-11-01', taken: false })]);
  });
});
