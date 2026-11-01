// Första veckan: a calm start. Day 1 shows only the check-in. From day 3 the app suggests a
// source for sleep. On day 7 it shows the first week, with what green means.

import type { DateKey } from '../domain/types';
import { daysBetween } from './dates';

export interface FirstWeek {
  /** 1 on the first day. */
  day: number;
  onlyCheckin: boolean;
  offerSleepSource: boolean;
  weekPicture: boolean;
}

export const GREEN_MEANS =
  'Grönt betyder att inget av dina tecken syntes den dagen. Det betyder inte att allt är bra, och det ersätter inte din egen känsla eller vården.';

export function firstWeek(
  firstUseAt: DateKey | null | undefined,
  today: DateKey,
  done: { sleepSourceDismissed: boolean; hasSleepSource: boolean; weekPictureSeen: boolean },
): FirstWeek | null {
  if (!firstUseAt) return null;
  const day = daysBetween(firstUseAt, today) + 1;
  if (day < 1 || day > 14) return null;
  return {
    day,
    onlyCheckin: day === 1,
    offerSleepSource: day >= 3 && day <= 10 && !done.sleepSourceDismissed && !done.hasSleepSource,
    weekPicture: day >= 7 && !done.weekPictureSeen,
  };
}
