// Kommande händelser: once a week the check-in asks about anything big coming up. The day
// before an event the home screen shows the plan's routines that fit it: if the event sounds
// like one of the plan's risk situations, the routines for that direction; otherwise the sleep
// routine. In the plan's own words; nothing is added.

import type { ContextEntry, DateKey } from '../domain/types';
import { sleepRoutineText } from './sleepNotice';
import { addDays, daysBetween } from './dates';
import { tokenize, wordsMatch } from './wordmatch';

export const ASK_EVERY_DAYS = 7;

export function askAboutEvents(lastAsked: DateKey | null, today: DateKey): boolean {
  return !lastAsked || daysBetween(lastAsked, today) >= ASK_EVERY_DAYS;
}

export function eventsOn(context: ContextEntry[], date: DateKey): ContextEntry[] {
  return context.filter((e) => e.kind === 'event' && e.date === date);
}

const STOP = new Set(['och', 'att', 'med', 'för', 'som', 'på', 'i', 'en', 'ett', 'av', 'till', 'det', 'den', 'jag', 'min', 'mitt', 'mina', 'när', 'om', 'är', 'har']);

const ENDINGS = ['orna', 'arna', 'erna', 'ena', 'or', 'ar', 'er', 'en', 'et', 'na', 'a', 'e', 'n', 'r'];

/** A rough Swedish stem: "resa" and "resor" are both "res". */
function stem(w: string): string {
  for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length);
  return w;
}

/** Shared words, inflections allowed: "Resa till Berlin" and "Långa resor över flera tidszoner". */
function sounds(a: string, b: string): boolean {
  const wa = tokenize(a).filter((w) => w.length > 2 && !STOP.has(w));
  const wb = tokenize(b).filter((w) => w.length > 2 && !STOP.has(w));
  return wa.some((x) => wb.some((y) => x === y || stem(x) === stem(y) || (Math.min(x.length, y.length) >= 4 && wordsMatch(x, y))));
}

export interface EventAdvice {
  event: string;
  date: DateKey;
  /** The risk situation in the plan the event sounds like. */
  trigger: string | null;
  routines: string[];
}

export function adviceFor(event: ContextEntry, context: ContextEntry[]): EventAdvice {
  const trigger = context.find((e) => e.kind === 'trigger' && sounds(event.text, e.text)) ?? null;
  const routines = context.filter((e) => e.kind === 'routine' && e.approvedAt != null);
  const dir = trigger?.plan?.polarity;
  let fit = dir === 'up' || dir === 'down' ? routines.filter((r) => r.plan?.polarity === dir).map((r) => r.text) : [];
  if (!fit.length) {
    const sleep = sleepRoutineText(routines);
    fit = sleep ? [sleep] : routines.filter((r) => (r.plan?.polarity ?? 'both') === 'both').slice(0, 1).map((r) => r.text);
  }
  return { event: event.text, date: event.date!, trigger: trigger?.text ?? null, routines: fit.slice(0, 4) };
}

/** The advice to show today: for events tomorrow. */
export function adviceForTomorrow(context: ContextEntry[], today: DateKey): EventAdvice[] {
  return eventsOn(context, addDays(today, 1)).map((e) => adviceFor(e, context));
}
