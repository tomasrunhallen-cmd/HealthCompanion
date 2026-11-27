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
  /** Days this week before today with an answer for this routine, done or not: a day without one is unknown, not missed. */
  answeredBeforeToday: number;
  /** Any answer for this routine at all. */
  everAnswered: boolean;
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
      const mine = answers.filter((e) => e.routineId === r.id);
      const answeredBeforeToday = new Set(mine.filter((e) => e.date! >= monday && e.date! < today).map((e) => e.date!)).size;
      const everAnswered = mine.length > 0;
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
      return { routine: r, frequency: f, doneThisWeek, goalThisWeek, daysLeft, doneToday, dueToday, lastDone, answeredBeforeToday, everAnswered, rate4w, urgency };
    });
}

/** What the code suggests on its own: the most pressing routines due today, at most `max`. */
export function rankDue(statuses: RoutineStatus[], max = 3): RoutineStatus[] {
  return statuses.filter((s) => s.dueToday).sort((a, b) => b.urgency - a.urgency || a.routine.order - b.routine.order).slice(0, max);
}

/** Days that count towards the goal: for a weekday goal only its planned days (a Saturday is not a Monday–Friday routine's). */
export function countedDays(f: RoutineFrequency, days: DateKey[]): DateKey[] {
  return f.kind === 'weekdays' ? days.filter((d) => f.days.includes(weekday(d))) : days;
}

export interface WeekCount {
  /** Times done that count towards the goal. */
  done: number;
  /** What the goal asked for, of the days that can be judged. */
  goal: number;
  /** Days that week with any routine answered. */
  answered: number;
  /**
   * The goal can be judged: reached, or missed for certain. A weekly goal with too few days
   * answered to know is open, not missed (granskning 27 november).
   */
  judged: boolean;
}

/**
 * One calendar week, Monday to Sunday, for one routine against its goal (28 November). A day
 * without any answer asks for nothing: a daily goal is the evenings with answers, a weekday goal
 * the planned days among them, both in the count and in the goal; a weekly goal is its number once
 * the week has any answer.
 */
export function weekGoal(f: RoutineFrequency, answeredDays: DateKey[], doneDays: DateKey[], daysInWeek = 7): WeekCount {
  const done = countedDays(f, doneDays).length;
  const goal = f.kind === 'daily' ? answeredDays.length : f.kind === 'weekly' ? (answeredDays.length ? f.times : 0) : countedDays(f, answeredDays).length;
  const unknown = Math.max(0, daysInWeek - answeredDays.length);
  const judged = f.kind !== 'weekly' || done >= goal || done + unknown < goal;
  return { done, goal, answered: answeredDays.length, judged };
}

export interface RoutineWeeks {
  routine: ContextEntry;
  frequency: RoutineFrequency;
  /** This week so far, Monday to today, and the days left after today. */
  current: WeekCount & { daysLeft: number };
  /** Full calendar weeks before this one, newest first. A week without any answer is left out. */
  past: (WeekCount & { from: DateKey })[];
}

/** Each routine week by week: this week so far and up to `weeks` full weeks before it. */
export function routineWeeks(entries: ContextEntry[], ids: string[], today: DateKey, weeks: number): RoutineWeeks[] {
  const monday = weekStart(today);
  const from = addDays(monday, -7 * weeks);
  const answers = entries.filter((e) => e.kind === 'routine_done' && e.date && e.date >= from && e.date <= today && e.done != null);
  const answered = [...new Set(answers.map((e) => e.date!))];
  const byId = new Map(routines(entries).map((r) => [r.id, r]));
  const inWeek = (start: DateKey, end: DateKey) => answered.filter((d) => d >= start && d <= end);
  return ids.map((id) => byId.get(id)).filter((r): r is ContextEntry => !!r).map((routine) => {
    const frequency = frequencyOf(routine);
    const doneDays = (start: DateKey, end: DateKey) => [...new Set(answers.filter((e) => e.routineId === routine.id && e.done && e.date! >= start && e.date! <= end).map((e) => e.date!))];
    const daysLeft = 7 - weekday(today);
    // This week the days still to come are unknown too: a weekly goal is open until it is reached or out of reach.
    const now = weekGoal(frequency, inWeek(monday, today), doneDays(monday, today), 7);
    const past: RoutineWeeks['past'] = [];
    for (let w = 1; w <= weeks; w++) {
      const start = addDays(monday, -7 * w), end = addDays(start, 6);
      const g = weekGoal(frequency, inWeek(start, end), doneDays(start, end));
      if (g.goal) past.push({ from: start, ...g });
    }
    return { routine, frequency, current: { ...now, daysLeft }, past };
  });
}
