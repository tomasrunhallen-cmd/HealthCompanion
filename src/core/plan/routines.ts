// Routines and lifestyle from the plan (Livsstil och rutiner): which ones the person logs in
// the evening check-in, daily reminders, and how often they were kept. Logging is a support
// for the person and never changes points or level. Nothing here is sent to a model.

import { addDays } from '../analysis/dates';
import type { ContextEntry, DateKey, RoutineSettings } from '../domain/types';

/** The settings a routine has, or its defaults: routines for both directions are logged, none remind. */
export function routineSettings(e: Pick<ContextEntry, 'routine' | 'plan'>): RoutineSettings {
  return {
    track: e.routine?.track ?? (e.plan?.polarity ?? 'both') === 'both',
    reminder: e.routine?.reminder ?? null,
  };
}

/** Approved routines, in plan order. */
export function routines(entries: ContextEntry[]): ContextEntry[] {
  return entries.filter((e) => e.kind === 'routine' && e.approvedAt != null).sort((a, b) => a.order - b.order);
}

export function trackedRoutines(entries: ContextEntry[]): ContextEntry[] {
  return routines(entries).filter((e) => routineSettings(e).track);
}

export type PlanMode = { direction: 'up' | 'down' } | null | undefined;

/**
 * The routines to tick off today: the daily ones, and the routines for a direction while the
 * person follows the plan for it (planMode). A routine the person turned off is left out.
 */
export function routinesToday(entries: ContextEntry[], mode: PlanMode): { daily: ContextEntry[]; extra: ContextEntry[] } {
  const all = routines(entries).filter((e) => e.routine?.track !== false);
  const pol = (e: ContextEntry) => e.plan?.polarity ?? 'both';
  return {
    daily: all.filter((e) => pol(e) === 'both'),
    extra: mode ? all.filter((e) => pol(e) === mode.direction) : all.filter((e) => pol(e) !== 'both' && e.routine?.track === true),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A reminder time read from the routine's own words: "klockan 21" gives 21:00, "kl. 7.30"
 * gives 07:30, a sleep window "Sömn 22:30–07:00" gives 22:00, half an hour before bedtime.
 * Null when the text has no time. Only a suggestion; the person sets the time.
 */
export function suggestReminderTime(text: string): string | null {
  const window = text.match(/(\d{1,2})[:.](\d{2})\s*(?:[–—-]|till)\s*(\d{1,2})[:.](\d{2})/);
  if (window && /sömn|sova|sover|lägg|sängen/i.test(text)) {
    const start = (Number(window[1]) * 60 + Number(window[2]) - 30 + 24 * 60) % (24 * 60);
    return `${pad(Math.floor(start / 60))}:${pad(start % 60)}`;
  }
  const at = text.match(/\b(?:klockan|kl\.?)\s*(\d{1,2})(?:[:.](\d{2}))?/i);
  if (at && Number(at[1]) < 24) return `${pad(Number(at[1]))}:${at[2] ?? '00'}`;
  return null;
}

/** Each routine's answer for a day: true done, false not done. Missing: not answered. */
export function routineLog(entries: ContextEntry[], date: DateKey): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const e of entries) if (e.kind === 'routine_done' && e.date === date && e.routineId && e.done != null) out.set(e.routineId, e.done);
  return out;
}

export interface RoutineStat {
  routine: ContextEntry;
  /** Days in the period when the person ticked off any routine, and days this one was done. */
  answered: number;
  done: number;
}

/**
 * How often each routine was kept the last `days` days, up to and including `today`. Counted
 * on the days the person ticked off routines at all, so a day without the app is not a miss.
 */
export function routineStats(entries: ContextEntry[], today: DateKey, days = 14): RoutineStat[] {
  const from = addDays(today, -(days - 1));
  const answers = entries.filter((e) => e.kind === 'routine_done' && e.date && e.date >= from && e.date <= today);
  const logged = new Set(answers.map((e) => e.date)).size;
  return routines(entries).map((routine) => ({
    routine,
    answered: logged,
    done: new Set(answers.filter((e) => e.routineId === routine.id && e.done).map((e) => e.date)).size,
  }));
}

/** The day's line on the result screen, in positive words: what was done. Null when nothing was answered. */
export function routineSummary(entries: ContextEntry[], date: DateKey, total?: number): { done: string[]; answered: number } | null {
  const log = routineLog(entries, date);
  if (!log.size) return null;
  const list = routines(entries);
  return { done: list.filter((r) => log.get(r.id) === true).map((r) => r.text), answered: total ?? log.size };
}
