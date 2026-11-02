// Dagen efter rött: the next check-in after a red day starts by asking whether the person did
// any of the plan's steps at red. The answers are saved and shown in Inför återbesök. They
// never change a level.

import type { Assessment, ContextEntry, DateKey, PlanItem } from '../domain/types';
import { actionsFor } from '../plan/guidance';
import { addDays } from './dates';

export interface RedFollowup {
  /** The red day the question is about. */
  date: DateKey;
  /** "I går var det rött." or the date when the red day was earlier. */
  yesterday: boolean;
  steps: string[];
}

/**
 * The question to ask today: the latest assessed day before today was red, and its steps have
 * not been answered. Only up to a week back; after that the question has lost its point.
 */
export function redFollowup(assessments: Assessment[], context: ContextEntry[], plan: PlanItem[], today: DateKey, skipped: DateKey | null = null): RedFollowup | null {
  const earlier = assessments.filter((a) => a.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const last = earlier[0];
  if (!last || last.level !== 'red' || last.date < addDays(today, -7)) return null;
  // "Vill inte svara": the question goes away for that red day.
  if (skipped === last.date) return null;
  const steps = actionsFor('red', plan).map((p) => p.text);
  if (!steps.length) return null;
  return { date: last.date, yesterday: last.date === addDays(today, -1), steps };
}

/** The answers for one red day, in the plan's order. */
export function redStepAnswers(context: ContextEntry[], date: DateKey): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const e of context) if (e.kind === 'red_step' && e.date === date && e.done != null) out.set(e.text, e.done);
  return out;
}

/** Every red day with answers, oldest first, within [from, to]. */
export function redStepsBetween(context: ContextEntry[], from: DateKey, to: DateKey): { date: DateKey; steps: { text: string; done: boolean }[] }[] {
  const dates = [...new Set(context.filter((e) => e.kind === 'red_step' && e.date && e.date >= from && e.date <= to).map((e) => e.date!))].sort();
  return dates.map((date) => ({ date, steps: [...redStepAnswers(context, date)].map(([text, done]) => ({ text, done })) }));
}
