// Lågt läge keeps what matters most when the latest evening was yellow or red: the level, its
// day, and the first step from the person's own plan. A green or old evening shows nothing.

import { firstStep } from './assess';
import { daysBetween } from './dates';
import { signDirection } from '../plan/guidance';
import type { Assessment, DateKey, Level, PlanItem } from '../domain/types';

/** How many days back the latest evening may be and still be shown. */
export const LOW_MODE_DAYS = 3;

export interface LowModeSupport {
  level: Exclude<Level, 'green'>;
  date: DateKey;
  /** The plan's first step at that level, or null when the plan has none. */
  step: string | null;
}

export function lowModeSupport(assessments: Assessment[], plan: PlanItem[], today: DateKey): LowModeSupport | null {
  const latest = assessments.filter((a) => a.date <= today).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest || latest.level === 'green' || daysBetween(latest.date, today) > LOW_MODE_DAYS) return null;
  const step = firstStep(latest.level, plan, signDirection(latest.signals, plan));
  return { level: latest.level, date: latest.date, step: step?.text ?? null };
}
