// Trend: one period for the page (7 days, 30 days, 6 months, 1 year). Short periods show each
// day; 6 months shows weeks and a year months. Routines kept are counted per day and bucket.

import { addDays } from '../src/core/analysis/dates';
import { bucketTrend, buildTrend, isoWeek, PERIOD_DAYS, PERIOD_GRAIN } from '../src/core/analysis/trend';
import type { Assessment, ContextEntry, Entry } from '../src/core/domain/types';
import { countedRoutineIds, routineShare } from '../src/core/plan/routines';
import { routineWeeks } from '../src/core/plan/routineFrequency';

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

  it('counts every counted routine on an evening with answers, so an unticked one is a miss, not nothing (granskning 25 november)', () => {
    // Only ticks are saved: on 2 November "a" was ticked, "b" and "c" were not.
    const ctx = [done('2026-11-02', 'a', true), done('2026-11-03', 'a', true), done('2026-11-03', 'b', true)];
    const t = buildTrend([], [], {}, TODAY, 14, ctx, ['a', 'b', 'c']);
    expect(t.days.find((d) => d.date === '2026-11-02')!.routines).toEqual({ done: 1, answered: 3 });
    expect(t.days.find((d) => d.date === '2026-11-03')!.routines).toEqual({ done: 2, answered: 3 });
    expect(t.days.find((d) => d.date === '2026-11-04')!.routines).toBeNull();
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

describe('the share of routines done, as Hem and Trend show it', () => {
  it('counts each counted routine on each evening with answers, and leaves out a routine never offered', () => {
    const r = (id: string, polarity: 'both' | 'up') => ({ id, layer: 'grund', kind: 'routine', text: id, order: id.length, approvedAt: '2026-11-01', plan: { polarity }, ...(polarity === 'both' ? { routine: { track: true, reminder: null } } : {}) }) as unknown as ContextEntry;
    // up1 is a routine for the up direction that the person has not chosen to tick every day.
    const ctx = [r('a', 'both'), r('b', 'both'), r('up1', 'up'), done('2026-11-02', 'a', true), done('2026-11-03', 'a', true), done('2026-11-03', 'b', true)];
    const ids = countedRoutineIds(ctx, null, '2026-11-02', '2026-11-08');
    expect(ids).toEqual(['a', 'b']);
    expect(routineShare(ctx, ids, '2026-11-02', '2026-11-08')).toEqual({ done: 3, possible: 4, evenings: 2 });
    // Following the up direction, its routine is offered and counts.
    expect(countedRoutineIds(ctx, { direction: 'up' }, '2026-11-02', '2026-11-08')).toEqual(['a', 'b', 'up1']);
  });
});

describe('routines against their own goals (28 November)', () => {
  it('calendar weeks: a weekly goal is its number, a daily goal the evenings with answers, weekdays only their days', () => {
    const r = (id: string, frequency: unknown, polarity = 'both') => ({ id, layer: 'grund', kind: 'routine', text: id, order: 0, approvedAt: '2026-11-01', plan: { polarity }, routine: { track: true, reminder: null, frequency } }) as unknown as ContextEntry;
    const ticks = (id: string, ns: number[]) => ns.map((n) => done(addDays(TODAY, -n), id, true));
    const ctx = [r('gym', { kind: 'weekly', times: 3 }), r('meds', { kind: 'daily' }), r('up1', { kind: 'daily' }, 'up'),
      ...ticks('gym', [0, 2, 4, 5]), ...ticks('meds', [0, 1, 2, 3, 4, 5]), done(addDays(TODAY, -6), 'meds', false)];
    const ids = countedRoutineIds(ctx, null, addDays(TODAY, -6), TODAY);
    expect(ids).toEqual(['gym', 'meds']);
    // TODAY is a Sunday: this calendar week is Monday 2 to Sunday 8 November, its last day.
    const w = routineWeeks(ctx, ids, TODAY, 1);
    expect(w.map((x) => [x.routine.id, x.current.done, x.current.goal, x.current.daysLeft])).toEqual([['gym', 4, 3, 0], ['meds', 6, 7, 0]]);
    expect(w.every((x) => x.past.length === 0)).toBe(true);
    // A weekday goal, Monday to Friday: the weekend asks for nothing.
    const work = [r('work', { kind: 'weekdays', days: [1, 2, 3, 4, 5] }), ...ctx.filter((e) => e.kind !== 'routine'), ...ticks('work', [2, 3, 4])];
    expect(routineWeeks(work, ['work'], TODAY, 1)[0].current).toMatchObject({ done: 3, goal: 5, daysLeft: 0 });
  });
});

describe('what is known about a week (granskning 27 november)', () => {
  const r = (id: string, frequency: unknown) => ({ id, layer: 'grund', kind: 'routine', text: id, order: 0, approvedAt: '2026-11-01', plan: { polarity: 'both' }, routine: { track: true, reminder: null, frequency } }) as unknown as ContextEntry;
  it('a Monday–Friday goal counts the same days in done and in goal: a Saturday walk is not a Monday', () => {
    // Week of 2 November: answered Monday 2 and Saturday 7, done only on Saturday.
    const ctx = [r('work', { kind: 'weekdays', days: [1, 2, 3, 4, 5] }), done('2026-11-02', 'other', false), done('2026-11-07', 'work', true)];
    expect(routineWeeks(ctx, ['work'], TODAY, 1)[0].current).toMatchObject({ done: 0, goal: 1 });
  });
  it('a weekly goal with too few days answered is open, not missed; reached is reached', () => {
    const ctx = [r('walk', { kind: 'weekly', times: 3 }), done('2026-10-27', 'walk', true), done('2026-10-29', 'x', false)];
    const [w] = routineWeeks(ctx, ['walk'], TODAY, 1);
    expect(w.past[0]).toMatchObject({ done: 1, goal: 3, answered: 2, judged: false });
    const full = [r('walk', { kind: 'weekly', times: 3 }), ...['2026-10-26', '2026-10-28', '2026-11-01'].map((d) => done(d, 'walk', true))];
    expect(routineWeeks(full, ['walk'], TODAY, 1)[0].past[0]).toMatchObject({ done: 3, goal: 3, judged: true });
  });
});
