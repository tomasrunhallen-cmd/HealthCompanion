// Startsidan shows one card at a time, folded to one line under the week and the day's
// routines (which have their own place). Each card that applies today is a candidate; the one
// with the highest priority is shown, and the person can put it aside until tomorrow, which
// brings the next one forward. Safety and things bound to today come first; reminders about
// the app itself come last.

import type { DateKey } from '../domain/types';

export type HomeCardKind =
  | 'silence'
  | 'start'
  | 'tomorrow'
  | 'remeasure'
  | 'reread'
  | 'sleepNotice'
  | 'weekPicture'
  | 'sleepSource'
  | 'suggestions'
  | 'review'
  | 'standardNudge';

/** Highest priority first. */
export const HOME_PRIORITY: readonly HomeCardKind[] = [
  'silence',
  'start',
  'tomorrow',
  'remeasure',
  'reread',
  'sleepNotice',
  'weekPicture',
  'sleepSource',
  'suggestions',
  'review',
  'standardNudge',
];

export interface HomeCard {
  kind: HomeCardKind;
  /** Stable for the day, e.g. one per event, so putting one aside does not hide another. */
  id: string;
}

/** Cards put aside today. Another day starts with an empty list. */
export interface HomeLater {
  date: DateKey;
  ids: string[];
}

export function laterToday(later: HomeLater | null | undefined, today: DateKey): string[] {
  return later?.date === today ? later.ids : [];
}

export function putAside(later: HomeLater | null | undefined, today: DateKey, id: string): HomeLater {
  const ids = laterToday(later, today);
  return { date: today, ids: ids.includes(id) ? ids : [...ids, id] };
}

/** The candidates in priority order, without the ones put aside today. */
export function homeQueue(candidates: HomeCard[], later: string[]): HomeCard[] {
  const rank = (c: HomeCard) => HOME_PRIORITY.indexOf(c.kind);
  return candidates.filter((c) => !later.includes(c.id)).sort((a, b) => rank(a) - rank(b));
}
