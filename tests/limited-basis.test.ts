// A green day on limited information is marked where colours are summed up, and a stress rule
// that could not be judged says so (review 15 November 2026). Nothing here raises a level.
import { limitedGreen, thinReasons } from '../src/core/analysis/coverage';
import { weekCounts } from '../src/core/analysis/levelWords';
import { score, stressGap, type HistoryDay } from '../src/core/analysis/scoring';
import { buildVisitSummary } from '../src/core/analysis/visit';
import type { Assessment, Entry, PlanItem } from '../src/core/domain/types';
import { levelCounts } from '../src/core/report/html';

const D = '2026-11-14';
const entry = (date: string, over: Partial<Entry> = {}): Entry => ({
  id: `e_${date}`, date, createdAt: `${date}T20:00:00`, localTime: '20:00', kind: 'checkin', transcript: 'Vanlig dag.',
  mood: 0, energy: 5, wordsPerMinute: null, sleepHours: 7.5, sleepSource: 'garmin', stressAvg: 20, ...over,
});
const sign: PlanItem = { id: 's1', kind: 'early', text: 'Svarar inte på sms', order: 0, approvedAt: 'x' };
const assessment = (e: Entry, over: Partial<Assessment> = {}): Assessment => ({
  id: `a_${e.id}`, entryId: e.id, date: e.date, createdAt: '', level: 'green', points: 0, signals: [], sentence: '', method: 'wordmatch',
  model: null, promptId: null, promptVersion: null, baseline: { wordsPerMinute: null, stressAvg: 20, greenDays: 10 },
  inputs: { rulesVersion: 'x', sentText: null, rawAnswer: null, signs: [sign], matches: [], planSettings: { sleepThresholdHours: 5 }, garmin: {}, medication: {}, baseline: { wordsPerMinute: null, stressAvg: 20, greenDays: 10 } },
  ...over,
});
const day = (date: string, stressAvg: number | null): HistoryDay => ({ entry: entry(date, { stressAvg }), level: 'green' });
const ps = { normalState: '', sleepThresholdHours: 5 };

describe('the stress rule says when it could not be judged', () => {
  it('counts the missing days only when the days that have a value are all at or above the limit', () => {
    expect(stressGap(D, [day('2026-11-12', 40), day('2026-11-13', null)], {}, 45)).toBe(1);
    expect(stressGap(D, [day('2026-11-12', null), day('2026-11-13', null)], {}, 45)).toBe(2);
    // A low day anyway: the rule could not have given a sign, so nothing is said.
    expect(stressGap(D, [day('2026-11-12', 20), day('2026-11-13', null)], {}, 45)).toBe(0);
    // No stress at all: nothing to say, and nothing to nag about.
    expect(stressGap(D, [day('2026-11-12', null), day('2026-11-13', null)], {}, null)).toBe(0);
    // All three days: judged as usual.
    expect(stressGap(D, [day('2026-11-12', 40), day('2026-11-13', 40)], {}, 45)).toBe(0);
  });

  it('is saved with the score, does not change the level, and shows under Underlaget är tunt', () => {
    const r = score({ entry: entry(D, { stressAvg: 45 }), matches: [], plan: [sign], planSettings: ps, history: [day('2026-11-12', 40), day('2026-11-13', null)] });
    expect(r.level).toBe('green');
    expect(r.stressMissingDays).toBe(1);
    const e = entry(D, { stressAvg: 45 });
    expect(thinReasons(e, assessment(e, { stressMissingDays: 1 }))).toContain('stressregeln kunde inte bedömas, en dag saknar stress');
    expect(thinReasons(e, assessment(e, { stressMissingDays: 2 }))).toContain('stressregeln kunde inte bedömas, 2 dagar saknar stress');
  });
});

describe('a green day on limited information', () => {
  it('is a green day with no signs in the plan, no note, no sleep, a lagging watch or an unjudged stress rule', () => {
    const full = entry(D);
    expect(limitedGreen(full, assessment(full))).toBe(false);
    expect(limitedGreen(full, assessment(full, { inputs: { ...assessment(full).inputs!, signs: [] } }))).toBe(true);
    const noNote = entry(D, { transcript: '' });
    expect(limitedGreen(noNote, assessment(noNote))).toBe(true);
    const noSleep = entry(D, { sleepHours: null });
    expect(limitedGreen(noSleep, assessment(noSleep))).toBe(true);
    expect(limitedGreen(full, assessment(full, { stressMissingDays: 1 }))).toBe(true);
  });

  it('is not every early day before the app knows the usual state, and never a yellow or red day', () => {
    const full = entry(D);
    expect(limitedGreen(full, assessment(full, { baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 } }))).toBe(false);
    const noSleep = entry(D, { sleepHours: null });
    expect(limitedGreen(noSleep, assessment(noSleep, { level: 'yellow', points: 1 }))).toBe(false);
  });

  it('is counted next to the green days on Hem and in the reports', () => {
    expect(weekCounts({ green: 4, yellow: 1, red: 0 }, 2, 2)).toBe('4 gröna dagar (2 med begränsat underlag), 1 gul, 2 dagar utan avstämning');
    expect(weekCounts({ green: 1, yellow: 0, red: 0 }, 6, 1)).toBe('1 grön dag (med begränsat underlag), 6 dagar utan avstämning');
    expect(weekCounts({ green: 4, yellow: 0, red: 0 }, 3, 0)).toBe('4 gröna dagar, 3 dagar utan avstämning');
    expect(levelCounts({ green: 3, yellow: 0, red: 1, none: 10, limitedGreen: 1 })).toBe('3 gröna (1 med begränsat underlag), 0 gula, 1 röd och 10 dagar utan avstämning.');
  });

  it('is a note on the day in the visit report', () => {
    const e1 = entry('2026-11-13');
    const e2 = entry(D, { transcript: '' });
    const s = buildVisitSummary({ today: D, days: 2, entries: [e1, e2], assessments: [assessment(e1), assessment(e2)], context: [], plan: [sign], measured: {}, topics: [] });
    expect(s.counts).toMatchObject({ green: 2, limitedGreen: 1 });
    expect(s.days.find((d) => d.date === D)?.notes).toContain('begränsat underlag');
    expect(s.days.find((d) => d.date === '2026-11-13')?.notes).not.toContain('begränsat underlag');
  });
});
