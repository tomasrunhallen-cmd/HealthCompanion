// How the plan's row fields are used after the level is set. Nothing here changes points or
// the level, which are computed in code from the signs as before. It only chooses what to
// show: which way the day's signs point, in the plan's own words; the actions and routines
// for that direction; the value anchors on hard days; and the plan's ladder in Hjälp nu.
// Wishes and notes for the care are never used here.

import type { Assessment, ContextEntry, DateKey, Level, PlanItem, PlanSettings, Polarity, Signal } from '../domain/types';
import { addDays } from '../analysis/dates';
import { polarityWord } from './fields';

/** Which way the matched signs point. Null when no matched sign has a direction. */
export function signDirection(signals: Signal[], plan: PlanItem[]): Polarity | null {
  const byId = new Map(plan.map((p) => [p.id, p]));
  const dirs = new Set<'up' | 'down'>();
  for (const s of signals) {
    // The person's own rating of stämning, and a personal text pattern, point the same way as a sign.
    if ((s.kind === 'mood_rated' || s.kind === 'text_pattern') && s.points > 0 && s.polarity) {
      dirs.add(s.polarity);
      continue;
    }
    if ((s.kind !== 'early_sign' && s.kind !== 'serious_sign') || s.points <= 0 || !s.planItemId) continue;
    const p = byId.get(s.planItemId)?.plan?.polarity;
    if (p === 'up' || p === 'down') dirs.add(p);
  }
  if (dirs.size === 2) return 'both';
  return dirs.size ? [...dirs][0] : null;
}

/** "Tecknen pekar åt ”mani”." in the plan's own words, or neutral words when it has none. */
export function directionSentence(dir: Polarity | null, settings: Pick<PlanSettings, 'polarityWords'> | null): string | null {
  if (!dir) return null;
  if (dir === 'both') return `Tecknen pekar åt båda hållen: ”${polarityWord('up', settings)}” och ”${polarityWord('down', settings)}”.`;
  return `Tecknen pekar åt ”${polarityWord(dir, settings)}”.`;
}

function fits(polarity: Polarity | undefined, dir: Polarity | null): boolean {
  return !dir || dir === 'both' || !polarity || polarity === 'both' || polarity === dir;
}

/** A step in the plan's ladder (Strategier för att undvika tvångsåtgärder). */
export function isLadderStep(p: Pick<PlanItem, 'plan'>): boolean {
  return p.plan?.kind === 'action' && p.plan.order != null;
}

/**
 * The person's own actions for a level, filtered by direction. What the care does and the
 * ladder are not the person's steps; the ladder is shown in Hjälp nu.
 */
export function actionsFor(level: Level, plan: PlanItem[], dir: Polarity | null = null): PlanItem[] {
  const kind = level === 'red' ? 'action_red' : level === 'yellow' ? 'action_yellow' : null;
  if (!kind) return [];
  return plan
    .filter((p) => p.kind === kind && !isLadderStep(p) && p.plan?.who !== 'care' && fits(p.plan?.polarity, dir))
    .sort((a, b) => a.order - b.order);
}

/** Routines, shown with the yellow actions, filtered by direction. */
export function routinesFor(entries: ContextEntry[], dir: Polarity | null = null): ContextEntry[] {
  return entries
    .filter((e) => e.kind === 'routine' && e.approvedAt != null && fits(e.plan?.polarity, dir))
    .sort((a, b) => a.order - b.order);
}

/** The plan's ladder, by its own heading, in step order. */
export function ladderOf(plan: PlanItem[]): { heading: string; steps: PlanItem[] } | null {
  const steps = plan.filter(isLadderStep).sort((a, b) => (a.plan!.order ?? 0) - (b.plan!.order ?? 0));
  if (!steps.length) return null;
  const chain = steps[0].plan?.sourceHeading ?? '';
  return { heading: chain.split(' > ').pop() || 'Planens steg', steps };
}

/**
 * Value anchors are shown on red, and after three yellow days in a row (this day and the two
 * before it, each with an assessment).
 */
export function showValueAnchors(a: Pick<Assessment, 'level' | 'date'>, history: Pick<Assessment, 'level' | 'date'>[]): boolean {
  if (a.level === 'red') return true;
  if (a.level !== 'yellow') return false;
  const levelOn = (d: DateKey) => history.find((h) => h.date === d)?.level;
  return levelOn(addDays(a.date, -1)) === 'yellow' && levelOn(addDays(a.date, -2)) === 'yellow';
}
