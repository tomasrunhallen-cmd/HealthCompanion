import { explainAssessment } from '../src/analysis/explain';
import { score, type HistoryDay } from '../src/analysis/scoring';
import type { Assessment, Entry, GarminDay, Level } from '../src/domain/types';
import { addDays } from '../src/analysis/dates';

const PS = { normalState: '', sleepThresholdHours: 5 };
const TODAY = '2026-11-04'; // a Wednesday; the week's baseline uses green days before Monday 2 November

function entry(date: string, over: Partial<Entry> = {}): Entry {
  return {
    id: `e_${date}`, date, createdAt: new Date(`${date}T21:00:00`).toISOString(), kind: 'checkin', transcript: 'Vanlig dag.',
    mood: 5, energy: 5, wordsPerMinute: null, sleepHours: 7.5, sleepSource: 'garmin', stressAvg: 30, ...over,
  };
}

function g(date: string, over: Partial<GarminDay> = {}): GarminDay {
  return { date, sleepHours: 7.5, deepMinutes: 80, remMinutes: 90, sleepStart: '23:00', sleepEnd: '06:30', stressAvg: 30, stressHighMinutes: 10, bodyBatteryWake: 70, fetchedAt: '', ...over };
}

/** Calm green days up to Sunday 1 November (stress baseline 30), and a calm Monday. No entry on Tuesday. */
const greenBefore = (last: string): HistoryDay[] => Array.from({ length: 12 }, (_, i) => ({ entry: entry(addDays(last, -i)), level: 'green' as Level }));
const greenWeeks: HistoryDay[] = [...greenBefore('2026-11-01'), { entry: entry('2026-11-02'), level: 'green' }];

// The party night: asleep at 03:00, 4 hours of sleep, stress 1.6 times the baseline.
const partyGarmin = g(TODAY, { sleepStart: '03:00', sleepEnd: '07:00', sleepHours: 4, stressAvg: 48 });
const partyEntry = (over: Partial<Entry> = {}) => entry(TODAY, { sleepHours: 4, stressAvg: 48, ...over });

describe('measured signs are not counted twice', () => {
  it('a party night with alcohol yesterday gives at most yellow, and says what was left out', () => {
    const e = partyEntry({ strainYesterday: true });
    const r = score({ entry: e, matches: [], plan: [], planSettings: PS, history: greenWeeks, garmin: { [TODAY]: partyGarmin } });
    expect(r.level).not.toBe('red');
    expect(r.level).toBe('yellow');
    expect(r.signals.map((s) => [s.kind, s.points, !!s.excused])).toEqual([
      ['sleep_low', 0, true],
      ['stress_high', 0, true],
      ['late_sleep_no_entry', 1, false],
    ]);
    expect(r.signals[0].label).toContain('räknas bort: alkohol, sjuk eller hård träning i går');
    const why = explainAssessment(e, { ...r, id: 'a', entryId: e.id, date: TODAY, createdAt: '', sentence: '', method: 'wordmatch', model: null, promptId: null, promptVersion: null, levelReason: r.reason } as Assessment, partyGarmin);
    expect(why.data).toContain('Du svarade ja på alkohol, sjuk eller hård träning i går. Sömn och stress räknades därför bort i dag');
  });

  it('the same party night without the excuse is still at most yellow: capped at 2 points, first day', () => {
    const r = score({ entry: partyEntry(), matches: [], plan: [], planSettings: PS, history: greenWeeks, garmin: { [TODAY]: partyGarmin } });
    expect(r.signals.map((s) => [s.kind, s.points, !!s.capped])).toEqual([
      ['sleep_low', 1, false],
      ['stress_high', 1, false],
      ['late_sleep_no_entry', 0, true],
    ]);
    expect(r.points).toBe(2);
    expect(r.level).toBe('yellow');
  });

  it('late sleep without an entry the evening before gives one point', () => {
    const r = score({ entry: entry(TODAY), matches: [], plan: [], planSettings: PS, history: greenWeeks, garmin: { [TODAY]: g(TODAY, { sleepStart: '02:30' }) } });
    expect(r.signals).toEqual([expect.objectContaining({ kind: 'late_sleep_no_entry', points: 1 })]);
  });
});

describe('measured signs give red only from the second day', () => {
  const badDays = (n: number): HistoryDay[] => Array.from({ length: n }, (_, i) => ({
    entry: entry(addDays(TODAY, -(i + 1)), { sleepHours: 4, stressAvg: 48 }),
    level: 'yellow' as Level,
  }));

  const base = greenBefore('2026-10-31');

  it('the same values two days in a row, without alcohol, illness or training, can give red', () => {
    const history = [...base, ...badDays(3)];
    const r = score({ entry: entry(TODAY, { sleepHours: 4, stressAvg: 48 }), matches: [], plan: [], planSettings: PS, history });
    expect(r.signals.filter((s) => s.points > 0).every((s) => s.persistent)).toBe(true);
    expect(r.points).toBe(2);
    expect(r).toMatchObject({ level: 'red', reason: 'recent_days' });
  });

  it('the same day with a good night before stays yellow, and says why', () => {
    const history = [...base, ...badDays(3)];
    history.find((h) => h.entry.date === addDays(TODAY, -1))!.entry = entry(addDays(TODAY, -1), { sleepHours: 7.5, stressAvg: 30 });
    const r = score({ entry: entry(TODAY, { sleepHours: 4, stressAvg: 48 }), matches: [], plan: [], planSettings: PS, history });
    expect(r.signals.some((s) => s.persistent)).toBe(false);
    expect(r).toMatchObject({ level: 'yellow', reason: 'measured_first_day', points: 2 });
  });

  it('a short night yesterday excused by alcohol does not count as the day before', () => {
    const history = [...base, ...badDays(3)];
    const y = history.find((h) => h.entry.date === addDays(TODAY, -1))!;
    y.entry = { ...y.entry, strainYesterday: true };
    const r = score({ entry: entry(TODAY, { sleepHours: 4, stressAvg: 48 }), matches: [], plan: [], planSettings: PS, history });
    expect(r.level).toBe('yellow');
  });

  it('a serious sign with only a first-day measured sign is not red', () => {
    const plan = [{ id: 'r', kind: 'serious' as const, text: 'Slutar äta', order: 0, approvedAt: 'x' }];
    const r = score({ entry: entry(TODAY, { sleepHours: 4 }), matches: [{ planItemId: 'r', quote: 'åt inget' }], plan, planSettings: PS, history: greenWeeks });
    expect(r).toMatchObject({ level: 'yellow', reason: 'measured_first_day', points: 3 });
  });
});

describe('the question in the check-in', () => {
  it('is saved with the entry and puts sleep and stress at 0', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveCheckin } = require('../src/services/checkin');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Repository } = require('../src/storage/repository');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { memoryBackend } = require('../src/storage/backend');
    const repo = await Repository.create(memoryBackend());
    const { entry: e, assessment } = await saveCheckin(repo, { transcript: 'Sov fyra timmar efter festen.', mood: 5, energy: 5, wordsPerMinute: null, strainYesterday: true }, new Date(2026, 10, 4, 21));
    expect(e.strainYesterday).toBe(true);
    expect(assessment.signals).toEqual([expect.objectContaining({ kind: 'sleep_low', points: 0, excused: true })]);
    expect(assessment.level).toBe('green');
  });
});
