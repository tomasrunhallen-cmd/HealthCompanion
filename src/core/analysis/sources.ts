// Sleep and stress from three sources (B5): Garmin, Apple Hälsa or Health Connect, and the
// person's own entry. Merged field by field: the person's own entry first, then the watch,
// then the phone's health app. Each merged day says where its sleep and stress came from.

import type { DateKey, MeasureSource, MeasuredDay } from '../domain/types';

/** Highest priority first. */
export const SOURCE_ORDER: MeasureSource[] = ['manual', 'garmin', 'health'];

export const SOURCE_TEXT: Record<MeasureSource | 'transcript', string> = {
  manual: 'egen uppgift',
  garmin: 'Garmin',
  health: 'Apple Hälsa eller Health Connect',
  transcript: 'skattat ur anteckningen',
};

/** "Sömn 7 h från Garmin", "Sömn 7 h som du själv angav". */
export const FROM_SOURCE: Record<MeasureSource, string> = {
  garmin: 'från Garmin',
  health: 'från Apple Hälsa eller Health Connect',
  manual: 'som du själv angav',
};

/** Manual stress as three steps, on Garmin's 0–100 scale. */
export const MANUAL_STRESS: Record<'low' | 'medium' | 'high', number> = { low: 25, medium: 50, high: 75 };

const SLEEP_FIELDS = ['sleepHours', 'deepMinutes', 'remMinutes', 'sleepStart', 'sleepEnd', 'bodyBatteryWake'] as const;

function mergeDay(date: DateKey, days: Partial<Record<MeasureSource, MeasuredDay>>): MeasuredDay | null {
  const ordered = SOURCE_ORDER.filter((s) => days[s]).map((s) => ({ s, d: days[s]! }));
  if (!ordered.length) return null;
  // Sleep comes as a whole from the first source that has it, so hours and times belong together.
  const sleep = ordered.find((x) => x.d.sleepHours != null) ?? ordered[0];
  const stress = ordered.find((x) => x.d.stressAvg != null);
  const out: MeasuredDay = {
    date,
    sleepHours: null, deepMinutes: null, remMinutes: null, sleepStart: null, sleepEnd: null,
    stressAvg: stress?.d.stressAvg ?? null,
    stressHighMinutes: stress?.d.stressHighMinutes ?? null,
    bodyBatteryWake: null,
    fetchedAt: sleep.d.fetchedAt,
    source: sleep.s,
    ...(stress ? { stressSource: stress.s } : {}),
  };
  // How far the watch had synced: Garmin's own readings, whichever value the day shows.
  const until = days.garmin?.dataUntil;
  if (until) out.dataUntil = until;
  for (const f of SLEEP_FIELDS) (out as unknown as Record<string, unknown>)[f] = sleep.d[f] ?? null;
  return out;
}

/** The days of all sources merged, keyed by date. */
export function mergeSources(bySource: Partial<Record<MeasureSource, Record<DateKey, MeasuredDay>>>): Record<DateKey, MeasuredDay> {
  const dates = new Set<DateKey>();
  for (const days of Object.values(bySource)) for (const d of Object.keys(days ?? {})) dates.add(d);
  const out: Record<DateKey, MeasuredDay> = {};
  for (const date of dates) {
    const day = mergeDay(date, Object.fromEntries(SOURCE_ORDER.map((s) => [s, bySource[s]?.[date]]).filter(([, d]) => d)) as Partial<Record<MeasureSource, MeasuredDay>>);
    if (day) out[date] = day;
  }
  return out;
}

/** Where the day's stress came from. */
export function stressSourceOf(d: MeasuredDay | null | undefined): MeasureSource | null {
  if (!d || d.stressAvg == null) return null;
  return d.stressSource ?? d.source ?? 'garmin';
}

export function sleepSourceOf(d: MeasuredDay | null | undefined): MeasureSource | null {
  if (!d || d.sleepHours == null) return null;
  return d.source ?? 'garmin';
}
