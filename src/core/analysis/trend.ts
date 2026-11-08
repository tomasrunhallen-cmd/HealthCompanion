// The days behind the Trend tab: level, mood, sleep and stress per day for the last 14 or 30
// days. Garmin first, then the entry, as in the assessment. Pure code.

import type { Assessment, ContextEntry, DateKey, Entry, GarminDay, Level } from '../domain/types';
import { addDays, weekStart } from './dates';

export interface TrendDay {
  date: DateKey;
  level: Level | null;
  /** Stämning as rated that evening, −3 to +3. */
  mood: number | null;
  sleepHours: number | null;
  stressAvg: number | null;
  /** Routines ticked off that evening: done, and answered at all. Null when none were answered. */
  routines: { done: number; answered: number } | null;
}

export interface Trend {
  days: TrendDay[];
  counts: Record<Level, number>;
  /** Days without any entry. */
  missing: number;
}

export function buildTrend(
  entries: Entry[],
  assessments: Assessment[],
  garmin: Record<DateKey, GarminDay>,
  today: DateKey,
  length: number,
  /** The context bank's daily rows; the routine answers among them are counted per day. */
  context: ContextEntry[] = [],
): Trend {
  const entryOn = new Map(entries.map((e) => [e.date, e]));
  const routineDays = new Map<DateKey, { done: number; answered: number }>();
  for (const c of context) {
    if (c.kind !== 'routine_done' || !c.date || c.done == null) continue;
    const r = routineDays.get(c.date) ?? { done: 0, answered: 0 };
    r.answered++;
    if (c.done) r.done++;
    routineDays.set(c.date, r);
  }
  const levelOf = new Map(assessments.map((a) => [a.entryId, a.level]));
  const days: TrendDay[] = [];
  for (let i = length - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const e = entryOn.get(date);
    const g = garmin[date];
    days.push({
      date,
      level: e ? levelOf.get(e.id) ?? null : null,
      mood: e?.mood ?? null,
      sleepHours: g?.sleepHours ?? e?.sleepHours ?? null,
      stressAvg: g?.stressAvg ?? e?.stressAvg ?? null,
      routines: routineDays.get(date) ?? null,
    });
  }
  const counts: Record<Level, number> = { green: 0, yellow: 0, red: 0 };
  for (const d of days) if (d.level) counts[d.level]++;
  return { days, counts, missing: days.filter((d) => !entryOn.has(d.date)).length };
}

// ---- Periods: 7 days, 30 days, 6 months, 1 year ----

export type TrendPeriod = '7d' | '30d' | '6m' | '1y';
export const PERIODS: readonly TrendPeriod[] = ['7d', '30d', '6m', '1y'];
export const PERIOD_DAYS: Record<TrendPeriod, number> = { '7d': 7, '30d': 30, '6m': 182, '1y': 365 };
export const PERIOD_LABEL: Record<TrendPeriod, string> = { '7d': '7 dagar', '30d': '30 dagar', '6m': '6 mån', '1y': '1 år' };

/** What one bar stands for: a day for the short periods, a week for 6 months, a month for a year. */
export type Grain = 'day' | 'week' | 'month';
export const PERIOD_GRAIN: Record<TrendPeriod, Grain> = { '7d': 'day', '30d': 'day', '6m': 'week', '1y': 'month' };
export const GRAIN_TEXT: Record<Grain, string> = { day: 'per dag', week: 'per vecka', month: 'per månad' };

export interface TrendBucket {
  key: string;
  /** "3 nov", "v. 45", "nov". */
  label: string;
  from: DateKey;
  to: DateKey;
  days: TrendDay[];
  counts: Record<Level, number>;
  /** Days in the bucket without an assessment. */
  missing: number;
  /** Averages over the days that have a value; null when none has. */
  mood: number | null;
  sleepHours: number | null;
  stressAvg: number | null;
  routines: { done: number; answered: number } | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** ISO 8601 week number: the week with the year's first Thursday is week 1. */
export function isoWeek(key: DateKey): number {
  const thursday = addDays(weekStart(key), 3);
  const [y] = thursday.split('-').map(Number);
  const jan4 = `${y}-01-04`;
  return Math.round((Date.parse(weekStart(thursday)) - Date.parse(weekStart(jan4))) / (7 * 864e5)) + 1;
}

const mean = (vals: (number | null)[]): number | null => {
  const v = vals.filter((x): x is number => x != null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

function dayLabel(key: DateKey): string {
  return `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
}

/** The days grouped by the period's grain, oldest first. A week or month at the edge may be partial. */
export function bucketTrend(days: TrendDay[], grain: Grain): TrendBucket[] {
  const keyOf = (d: DateKey) => (grain === 'day' ? d : grain === 'week' ? weekStart(d) : d.slice(0, 7));
  const groups = new Map<string, TrendDay[]>();
  for (const d of days) {
    const k = keyOf(d.date);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return Array.from(groups, ([key, ds]) => {
    const counts: Record<Level, number> = { green: 0, yellow: 0, red: 0 };
    for (const d of ds) if (d.level) counts[d.level]++;
    const answered = ds.reduce((n, d) => n + (d.routines?.answered ?? 0), 0);
    const done = ds.reduce((n, d) => n + (d.routines?.done ?? 0), 0);
    const from = ds[0].date;
    return {
      key,
      label: grain === 'day' ? dayLabel(key) : grain === 'week' ? `v. ${isoWeek(from)}` : MONTHS[Number(key.slice(5, 7)) - 1],
      from,
      to: ds[ds.length - 1].date,
      days: ds,
      counts,
      missing: ds.filter((d) => !d.level).length,
      mood: mean(ds.map((d) => d.mood)),
      sleepHours: mean(ds.map((d) => d.sleepHours)),
      stressAvg: mean(ds.map((d) => d.stressAvg)) == null ? null : Math.round(mean(ds.map((d) => d.stressAvg))!),
      routines: answered ? { done, answered } : null,
    };
  });
}
