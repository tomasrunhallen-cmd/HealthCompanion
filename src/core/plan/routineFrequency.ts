// How often a routine should be done, and how it has gone: this week against the goal, the
// last time it was done, and the last four weeks. Pure code: the language model only chooses
// among the routines this file puts forward and words the reason (prompts/dagsforslag.md).

import { addDays, weekStart } from '../analysis/dates';
import type { ContextEntry, DateKey, RoutineFrequency } from '../domain/types';
import { routines } from './routines';

export const WEEKDAY_SHORT = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'];
const WEEKDAY_WORDS: [RegExp, number][] = [
  [/måndag/i, 1], [/tisdag/i, 2], [/onsdag/i, 3], [/torsdag/i, 4], [/fredag/i, 5], [/lördag/i, 6], [/söndag/i, 7],
];
const NUMBER_WORDS: Record<string, number> = { en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6 };

/** 1 Monday … 7 Sunday. */
export function weekday(key: DateKey): number {
  const [y, m, d] = key.split('-').map(Number);
  const js = new Date(y, m - 1, d, 12).getDay();
  return js === 0 ? 7 : js;
}

/**
 * A frequency read from the routine's own words, as a suggestion: "varje dag" every day,
 * "3 gånger i veckan" three times, "varannan dag" three times a week, "måndag och torsdag"
 * those days. Null when the words say nothing.
 */
export function suggestFrequency(text: string): RoutineFrequency | null {
  const t = text.toLowerCase();
  const days = WEEKDAY_WORDS.filter(([re]) => re.test(t)).map(([, d]) => d);
  if (days.length) return { kind: 'weekdays', days };
  const times = t.match(/(\d|en|ett|två|tre|fyra|fem|sex)\s*(?:gång|gånger|ggr|pass)\s*(?:i|per|\/)\s*(?:veckan|vecka|v\b)/);
  if (times) {
    const n = /\d/.test(times[1]) ? Number(times[1]) : NUMBER_WORDS[times[1]];
    if (n >= 1 && n <= 6) return { kind: 'weekly', times: n };
    if (n === 7) return { kind: 'daily' };
  }
  if (/varannan dag/.test(t)) return { kind: 'weekly', times: 3 };
  if (/varje (dag|kväll|morgon)|dagligen|varje natt/.test(t)) return { kind: 'daily' };
  return null;
}

/** The frequency in use: the person's own choice, else the routine's words, else every day. */
export function frequencyOf(e: Pick<ContextEntry, 'text' | 'routine'>): RoutineFrequency {
  return e.routine?.frequency ?? suggestFrequency(e.text) ?? { kind: 'daily' };
}

export function frequencyText(f: RoutineFrequency): string {
  if (f.kind === 'daily') return 'varje dag';
  if (f.kind === 'weekly') return f.times === 1 ? 'en gång i veckan' : `${f.times} gånger i veckan`;
  const names = [...f.days].sort().map((d) => WEEKDAY_SHORT[d - 1]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} och ${names[names.length - 1]}` : names[0] ?? 'inga dagar';
}

/** Times a week the frequency asks for. */
function perWeek(f: RoutineFrequency): number {
  return f.kind === 'daily' ? 7 : f.kind === 'weekly' ? f.times : f.days.length;
}

export interface RoutineStatus {
  routine: ContextEntry;
  frequency: RoutineFrequency;
  /** Done this week (Monday to today) and the week's goal. */
  doneThisWeek: number;
  goalThisWeek: number;
  /** Days left this week, today included. */
  daysLeft: number;
  doneToday: boolean;
  /** Something to do today: every day, a planned weekday, or a weekly goal not yet reached. */
  dueToday: boolean;
  lastDone: DateKey | null;
  /** Done against what was asked over the four weeks before this one, 0–1. Null without answers then. */
  rate4w: number | null;
  /** How pressing today is, for ordering: higher first. */
  urgency: number;
}

/**
 * The status of each tracked routine on `today`. Earlier weeks count only evenings with an
 * answer (a day without the app is not a miss), except for a weekly goal, which is per week.
 */
export function routineStatuses(entries: ContextEntry[], today: DateKey): RoutineStatus[] {
  const answers = entries.filter((e) => e.kind === 'routine_done' && e.date && e.routineId && e.done != null);
  const answeredDays = new Set(answers.map((e) => e.date!));
  const monday = weekStart(today);
  const daysLeft = 7 - (weekday(today) - 1);
  const histFrom = addDays(monday, -28);
  return routines(entries)
    .filter((r) => r.routine?.track !== false && (r.plan?.polarity ?? 'both') === 'both')
    .map((r) => {
      const f = frequencyOf(r);
      const doneDays = new Set(answers.filter((e) => e.routineId === r.id && e.done).map((e) => e.date!));
      const doneThisWeek = [...doneDays].filter((d) => d >= monday && d <= today).length;
      const doneToday = doneDays.has(today);
      const lastDone = [...doneDays].filter((d) => d <= today).sort().pop() ?? null;
      const goalThisWeek = perWeek(f);

      // The four weeks before this one.
      let asked = 0;
      let done = 0;
      if (f.kind === 'weekly') {
        for (let w = 0; w < 4; w++) {
          const from = addDays(histFrom, w * 7);
          const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
          if (!days.some((d) => answeredDays.has(d))) continue;
          asked += f.times;
          done += Math.min(f.times, days.filter((d) => doneDays.has(d)).length);
        }
      } else {
        for (let i = 0; i < 28; i++) {
          const d = addDays(histFrom, i);
          if (!answeredDays.has(d)) continue;
          if (f.kind === 'weekdays' && !f.days.includes(weekday(d))) continue;
          asked++;
          if (doneDays.has(d)) done++;
        }
      }
      const rate4w = asked ? done / asked : null;

      const remaining = Math.max(0, goalThisWeek - doneThisWeek);
      const dueToday = !doneToday && (
        f.kind === 'daily' ? true : f.kind === 'weekdays' ? f.days.includes(weekday(today)) : remaining > 0
      );
      // A weekly goal that needs every remaining day is as pressing as a planned day; one kept
      // less often lately weighs a little more, so it is not forgotten.
      const need = f.kind === 'weekly' ? Math.min(1, remaining / daysLeft) : f.kind === 'weekdays' ? 0.9 : 0.6;
      const urgency = dueToday ? need + 0.4 * (1 - (rate4w ?? 0.5)) : 0;
      return { routine: r, frequency: f, doneThisWeek, goalThisWeek, daysLeft, doneToday, dueToday, lastDone, rate4w, urgency };
    });
}

/** What the code suggests on its own: the most pressing routines due today, at most `max`. */
export function rankDue(statuses: RoutineStatus[], max = 3): RoutineStatus[] {
  return statuses.filter((s) => s.dueToday).sort((a, b) => b.urgency - a.urgency || a.routine.order - b.routine.order).slice(0, max);
}
