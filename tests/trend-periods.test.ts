// Trend: one period for the page (7 days, 30 days, 6 months, 1 year). Short periods show each
// day; 6 months shows weeks and a year months. Routines kept are counted per day and bucket.

import { addDays } from '../src/core/analysis/dates';
import { bucketTrend, buildTrend, isoWeek, PERIOD_DAYS, PERIOD_GRAIN } from '../src/core/analysis/trend';
import type { Assessment, ContextEntry, Entry } from '../src/core/domain/types';

const TODAY = '2026-11-08'; // a Sunday, week 45

const entry = (date: string, over: Partial<Entry> = {}): Entry => ({
  id: `e_${date}`, date, createdAt: `${date}T20:00:00.000Z`, kind: 'checkin', transcript: '', mood: 0, energy: 5,
  wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null, ...over,
});
const done = (date: string, routineId: string, ok: boolean) => ({ id: `r_${date}_${routineId}`, layer: 'dagligt', kind: 'routine_done', date, routineId, done: ok, text: '' }) as unknown as ContextEntry;

describe('Trendens perioder', () => {
  it('7 and 30 days show days, 6 months weeks, a year months', () => {
    expect(PERIOD_DAYS).toEqual({ '7d': 7, '30d': 30, '6m': 182, '1y': 365 });
    expect(PERIOD_GRAIN).toEqual({ '7d': 'day', '30d': 'day', '6m': 'week', '1y': 'month' });
  });

  it('ISO week numbers, also across the new year', () => {
    expect(isoWeek('2026-11-08')).toBe(45);
    expect(isoWeek('2026-11-09')).toBe(46);
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2024-12-30')).toBe(1);
  });

  it('counts routines per day, and groups days into weeks and months with means', () => {
    const entries = [entry('2026-11-02', { mood: -2, sleepHours: 6, stressAvg: 30 }), entry('2026-11-03', { mood: 1, sleepHours: 8, stressAvg: 40 }), entry('2026-11-08', { mood: 0 })];
    const assessments = entries.map((e, i) => ({ entryId: e.id, level: i === 0 ? 'yellow' : 'green' })) as unknown as Assessment[];
    const ctx = [done('2026-11-02', 'a', true), done('2026-11-02', 'b', false), done('2026-11-03', 'a', true), done('2026-11-03', 'b', true)];
    const t = buildTrend(entries, assessments, {}, TODAY, 14, ctx);
    expect(t.days.find((d) => d.date === '2026-11-02')!.routines).toEqual({ done: 1, answered: 2 });
    expect(t.days.find((d) => d.date === '2026-11-04')!.routines).toBeNull();

    const weeks = bucketTrend(t.days, 'week');
    expect(weeks.map((w) => w.label)).toEqual(['v. 44', 'v. 45']);
    const w45 = weeks[1];
    expect([w45.from, w45.to, w45.days.length]).toEqual(['2026-11-02', '2026-11-08', 7]);
    expect(w45).toMatchObject({ counts: { green: 2, yellow: 1, red: 0 }, missing: 4, mood: -0.3, moodMin: -2, moodMax: 1, sleepHours: 7, stressAvg: 35, routines: { done: 3, answered: 4 } });
    expect(weeks[0]).toMatchObject({ mood: null, moodMin: null, moodMax: null, routines: null });

    const year = buildTrend(entries, assessments, {}, TODAY, 365, ctx);
    const months = bucketTrend(year.days, 'month');
    expect(months).toHaveLength(13);
    expect([months[0].label, months[0].from, months[12].label, months[12].to]).toEqual(['nov', addDays(TODAY, -364), 'nov', TODAY]);

    const days = bucketTrend(t.days, 'day');
    expect(days).toHaveLength(14);
    expect(days[13]).toMatchObject({ label: '8 nov', mood: 0 });
  });
});

describe('Garmins värden sparas', () => {
  it('days older than 120 move to the monthly archive instead of being removed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Repository } = require('../src/storage/repository');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { memoryBackend } = require('../src/storage/backend');
    const repo = await Repository.create(memoryBackend());
    const g = (date: string) => ({ date, sleepHours: 7, deepMinutes: null, remMinutes: null, sleepStart: null, sleepEnd: null, stressAvg: 28, stressHighMinutes: null, bodyBatteryWake: null, fetchedAt: '' });
    await repo.saveGarminDays([g('2026-05-01'), g('2026-07-01'), g('2026-11-01')], '2026-07-02');
    // Four months later the window moves on: May and July leave the window but stay in the archive.
    await repo.saveGarminDays([g('2026-11-08')], '2026-11-08');
    expect(Object.keys(repo.garminDays()).sort()).toEqual(['2026-11-01', '2026-11-08']);
    expect(Object.keys(repo.garminArchive()).sort()).toEqual(['2026-05-01', '2026-07-01']);
    expect(Object.keys(repo.allMeasuredDays()).sort()).toEqual(['2026-05-01', '2026-07-01', '2026-11-01', '2026-11-08']);
  });
});
