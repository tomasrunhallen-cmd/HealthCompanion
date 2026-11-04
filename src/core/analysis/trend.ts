// The days behind the Trend tab: level, mood, sleep and stress per day for the last 14 or 30
// days. Garmin first, then the entry, as in the assessment. Pure code.

import type { Assessment, DateKey, Entry, GarminDay, Level } from '../domain/types';
import { addDays } from './dates';

export interface TrendDay {
  date: DateKey;
  level: Level | null;
  /** Stämning as rated that evening, −3 to +3. */
  mood: number | null;
  sleepHours: number | null;
  stressAvg: number | null;
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
): Trend {
  const entryOn = new Map(entries.map((e) => [e.date, e]));
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
    });
  }
  const counts: Record<Level, number> = { green: 0, yellow: 0, red: 0 };
  for (const d of days) if (d.level) counts[d.level]++;
  return { days, counts, missing: days.filter((d) => !entryOn.has(d.date)).length };
}
