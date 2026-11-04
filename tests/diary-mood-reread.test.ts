// The diary's "Depression" is Dagsljus's Depression (−2), not Akut depression (−3), which weighs
// as a serious sign. Imported days are read again (schema 6), and their levels change only when
// the person recomputes the history and saves.

import { assessEntry, type SignMatcher } from '../src/core/analysis/assess';
import { rereadDays } from '../src/core/analysis/recompute';
import type { Entry, PlanItem } from '../src/core/domain/types';
import { DEFAULT_PLAN_SETTINGS } from '../src/core/domain/types';
import { moodOf, type DiaryDay } from '../src/import/bipolarDagbok';
import { applyRecompute, previewRecompute } from '../src/services/recompute';
import { emptySnapshot, memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const day = (low: string): DiaryDay => ({ date: '2024-03-06', note: '', values: { 'Lågt Humör': low, 'Högt Humör': '-' } } as DiaryDay);

const PLAN: PlanItem[] = [
  { id: 'sms', kind: 'early', text: 'Svarar inte på sms', order: 0, approvedAt: '2026-01-01' },
  { id: 'r1', kind: 'action_red', text: 'Ringer mottagningen', order: 0, approvedAt: '2026-01-01' },
];

const imported = (id: string, date: string, low: string, mood: number): Entry => ({
  id, date, createdAt: `${date}T12:00:00.000Z`, kind: 'imported', transcript: 'Svarade inte på sms.',
  mood, energy: null, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null,
  imported: { importId: 'i1', source: 'bipolar-dagbok', values: { 'Lågt Humör': low, 'Högt Humör': '-' } },
} as Entry);

describe('Bipolär dagbok: stämningen', () => {
  it('Depression is −2, not the acute −3; Mild Depression −2 and Nedstämdhet −1 as before', () => {
    expect(moodOf(day('Depression'))).toBe(-2);
    expect(moodOf(day('Mild Depression'))).toBe(-2);
    expect(moodOf(day('Nedstämdhet'))).toBe(-1);
  });

  it('imported days are read again, and the level changes only when the history is recomputed and saved', async () => {
    // An import made before: "Depression" read as −3, and with an early sign the day was red.
    const sign: SignMatcher = { async match() { return { matches: [{ planItemId: 'sms', quote: 'Svarade inte på sms' }], sentence: null, method: 'import', model: null, promptId: null, promptVersion: null }; } };
    const old = imported('d1', '2024-03-06', 'Depression', -3);
    const calm = imported('d0', '2024-03-05', 'Nedstämdhet', -1);
    const a0 = await assessEntry({ entry: calm, plan: PLAN, planSettings: DEFAULT_PLAN_SETTINGS, history: [], matcher: { async match() { return { matches: [], sentence: null, method: 'import', model: null, promptId: null, promptVersion: null }; } }, now: new Date('2024-03-05T12:00:00Z') });
    const a1 = await assessEntry({ entry: old, plan: PLAN, planSettings: DEFAULT_PLAN_SETTINGS, history: [{ entry: calm, level: a0.level }], matcher: sign, now: new Date('2024-03-06T12:00:00Z') });
    expect([a1.level, a1.levelReason]).toEqual(['red', 'serious_plus_other']);

    const snap = emptySnapshot();
    snap.kv.schemaVersion = 5;
    snap.entries.d0 = calm;
    snap.entries.d1 = old;
    for (const [e, a] of [[calm, a0], [old, a1]] as const) {
      snap.assessments[`a_${e.id}`] = { ...a, id: `a_${e.id}`, entryId: e.id, method: 'import', createdAt: e.createdAt };
    }
    const backend = memoryBackend(snap);
    const repo = await Repository.create(backend);

    // The entry is read again from the diary's word; the level waits for the person.
    const d1 = repo.entries().find((e) => e.id === 'd1')!;
    expect(d1).toMatchObject({ mood: -2, moodReread: { was: -3 } });
    expect(repo.entries().find((e) => e.id === 'd0')!.moodReread).toBeUndefined();
    expect(repo.assessments().find((a) => a.entryId === 'd1')!.level).toBe('red');
    expect(rereadDays(repo.entries(), repo.assessments())).toBe(1);

    // Räkna om historiken shows the difference and why, before anything is saved.
    const days = previewRecompute(repo);
    const changed = days.filter((d) => d.changed);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ date: '2024-03-06', before: { level: 'red' }, after: { level: 'yellow' }, moodReread: { from: -3, to: -2 } });
    expect(repo.assessments().find((a) => a.entryId === 'd1')!.level).toBe('red');

    await applyRecompute(repo, days);
    expect(repo.assessments().find((a) => a.entryId === 'd1')!).toMatchObject({ level: 'yellow', recomputed: { level: 'red' } });
    expect(rereadDays(repo.entries(), repo.assessments())).toBe(0);

    // Opening again reads nothing again.
    const again = await Repository.create(backend);
    expect(again.entries().find((e) => e.id === 'd1')!.moodReread!.was).toBe(-3);
    expect(rereadDays(again.entries(), again.assessments())).toBe(0);
  });
});
