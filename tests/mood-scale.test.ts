import { MOOD_SCALE, moodFromTen, moodPolarity, moodStep, moodText } from '../src/core/analysis/mood';
import { RULES } from '../src/core/analysis/rules';
import { score } from '../src/core/analysis/scoring';
import { signDirection } from '../src/core/plan/guidance';
import type { Entry } from '../src/core/domain/types';
import { emptySnapshot, memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import { DEFAULT_PLAN_SETTINGS } from '../src/core/domain/types';

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1', date: '2026-11-02', createdAt: '2026-11-02T20:00:00', localTime: '20:00', kind: 'checkin', transcript: '',
  mood: 0, energy: 5, wordsPerMinute: null, sleepHours: 7.5, sleepSource: 'garmin', stressAvg: null, ...over,
});

describe('Stämning från Akut depression till Akut mani', () => {
  it('has seven steps from −3 to +3 with the person\'s words', () => {
    expect(MOOD_SCALE.map((s) => s.label)).toEqual(['Akut depression', 'Depression', 'Nedstämdhet', 'Balanserad', 'Glädje', 'Uppvarvning', 'Akut mani']);
    expect(moodStep(-3).hint).toBe('Klarar inte vardagen');
    expect(moodText(-1)).toBe('Nedstämdhet (−1)');
    expect(moodText(2)).toBe('Uppvarvning (+2)');
    expect(moodText(0)).toBe('Balanserad (0)');
    expect(moodPolarity(2)).toBe('up');
    expect(moodPolarity(-1)).toBe('down');
    expect(moodPolarity(0)).toBeNull();
  });

  it('moves the old 1–10 values onto the scale: the ends to the ends, 5 and 6 to balanced', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(moodFromTen)).toEqual([-3, -2, -2, -1, 0, 0, 1, 2, 2, 3]);
    expect(Object.is(moodFromTen(5), -0)).toBe(false);
  });

  it('gives no point for −1 to +1, one for ±2 and two for ±3, in the direction rated', () => {
    const at = (mood: number) => score({ entry: entry({ mood }), matches: [], plan: [], planSettings: DEFAULT_PLAN_SETTINGS, history: [] });
    for (const m of [-1, 0, 1]) expect(at(m).signals.filter((s) => s.kind === 'mood_rated')).toEqual([]);
    expect(at(2).signals).toEqual([expect.objectContaining({ kind: 'mood_rated', points: RULES.points.moodModerate, polarity: 'up', label: 'Du skattade stämningen som uppvarvning' })]);
    expect(at(-3).signals).toEqual([expect.objectContaining({ kind: 'mood_rated', points: RULES.points.moodSevere, polarity: 'down', label: 'Du skattade stämningen som akut depression' })]);
    expect(at(-3).level).toBe('yellow');
    expect(signDirection(at(3).signals, [])).toBe('up');
  });

  it('counts a jump of two steps against the last week', () => {
    const history = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((date, i) => ({ entry: entry({ id: `h${i}`, date, mood: 0 }), level: 'green' as const }));
    const r = score({ entry: entry({ mood: -2 }), matches: [], plan: [], planSettings: DEFAULT_PLAN_SETTINGS, history });
    expect(r.signals.map((s) => s.kind).sort()).toEqual(['mood_jump', 'mood_rated']);
    const small = score({ entry: entry({ mood: 1 }), matches: [], plan: [], planSettings: DEFAULT_PLAN_SETTINGS, history });
    expect(small.signals).toEqual([]);
  });

  it('moves saved entries to the new scale once, keeping the old value, and reads imported days from the diary', async () => {
    const snap = emptySnapshot();
    snap.kv.schemaVersion = 3;
    snap.entries.a = entry({ id: 'a', mood: 8 });
    snap.entries.b = entry({ id: 'b', date: '2026-11-01', mood: 4, kind: 'imported', imported: { importId: 'i', source: 'bipolar_dagbok' as never, values: { 'Lågt Humör': 'Mild Depression', 'Högt Humör': '-' } } });
    snap.entries.c = entry({ id: 'c', date: '2026-10-31', mood: null });
    const backend = memoryBackend(snap);
    const repo = await Repository.create(backend);
    const byId = Object.fromEntries(repo.entries().map((e) => [e.id, e]));
    expect(byId.a).toMatchObject({ mood: 2, moodTen: 8 });
    expect(byId.b).toMatchObject({ mood: -2, moodTen: 4 });
    expect(byId.c.mood).toBeNull();
    // Opening again changes nothing.
    const again = await Repository.create(backend);
    expect(again.entries().find((e) => e.id === 'a')).toMatchObject({ mood: 2, moodTen: 8 });
  });
});
