// Sömnnotis: when the sleep source shows the third night in a row under the person's own
// average, or outside the plan's sleep window, the person gets one quiet notice with the plan's
// own sleep routine. No points, no level: a reminder of what the person has already planned.

import type { DateKey, MeasuredDay } from '../domain/types';
import { addDays } from './dates';

export const NOTICE_NIGHTS = 3;
/** Minutes outside the window before a night counts as outside it. */
const WINDOW_SLACK_MIN = 60;
/** Nights needed for the person's own average. */
const AVERAGE_MIN_NIGHTS = 5;

export interface SleepNotice {
  reason: 'short' | 'window';
  /** The nights, oldest first: the mornings the person woke up. */
  nights: DateKey[];
  /** The person's own average, for "short". */
  average: number | null;
  title: string;
  body: string;
}

const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Minutes from the window's start to falling asleep, counted over midnight. Negative: earlier. */
function lateBy(sleepStart: string, windowStart: string): number {
  let d = min(sleepStart) - min(windowStart);
  if (d < -12 * 60) d += 24 * 60;
  if (d > 12 * 60) d -= 24 * 60;
  return d;
}

export function sleepNotice(
  measured: Record<DateKey, MeasuredDay>,
  today: DateKey,
  opts: { window: { start: string; end: string } | null; sleepRoutine: string | null },
): SleepNotice | null {
  const nights = Array.from({ length: NOTICE_NIGHTS }, (_, i) => addDays(today, -(NOTICE_NIGHTS - 1 - i)));
  const days = nights.map((d) => measured[d]);
  if (days.some((d) => d?.sleepHours == null)) return null;

  const earlier: number[] = [];
  for (let i = NOTICE_NIGHTS; i < NOTICE_NIGHTS + 28; i++) {
    const h = measured[addDays(today, -i)]?.sleepHours;
    if (h != null) earlier.push(h);
  }
  const average = earlier.length >= AVERAGE_MIN_NIGHTS ? Math.round((earlier.reduce((a, b) => a + b, 0) / earlier.length) * 10) / 10 : null;
  const plan = opts.sleepRoutine ? ` Din plan säger: ”${opts.sleepRoutine}”.` : '';

  if (average != null && days.every((d) => d!.sleepHours! < average)) {
    return {
      reason: 'short', nights, average,
      title: 'Sömnen',
      body: `Tredje natten i rad med kortare sömn än ditt snitt på ${String(average).replace('.', ',')} timmar.${plan}`,
    };
  }
  if (opts.window) {
    const w = opts.window;
    const outside = (d: MeasuredDay) =>
      (d.sleepStart != null && Math.abs(lateBy(d.sleepStart, w.start)) > WINDOW_SLACK_MIN) ||
      (d.sleepEnd != null && Math.abs(lateBy(d.sleepEnd, w.end)) > WINDOW_SLACK_MIN);
    if (days.every((d) => outside(d!))) {
      return {
        reason: 'window', nights, average,
        title: 'Sömnen',
        body: `Tredje natten i rad utanför ditt sömnfönster ${w.start}–${w.end}.${plan}`,
      };
    }
  }
  return null;
}

/** The plan's sleep routine: a routine about sleep, preferably one with a time window. */
export function sleepRoutineText(routines: { text: string }[]): string | null {
  const sleep = routines.filter((r) => /sömn|sova|sover|lägg(a|er) mig|sängen/i.test(r.text));
  return (sleep.find((r) => /\d{1,2}[:.]\d{2}\s*(?:[–—-]|till)\s*\d{1,2}[:.]\d{2}/.test(r.text)) ?? sleep[0])?.text ?? null;
}
