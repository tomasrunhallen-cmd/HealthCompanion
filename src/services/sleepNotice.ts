// The sleep notice: checked when new sleep data arrives or the app opens. At most one per day.

import { eveningDateKey } from '../core/analysis/dates';
import { sleepNotice, sleepRoutineText, type SleepNotice } from '../core/analysis/sleepNotice';
import type { DateKey } from '../core/domain/types';
import { notifyNow } from '../platform/reminder';
import type { Repository } from '../storage/repository';

export const NOTICE_KEY = 'sleepNotice';

export interface StoredNotice extends SleepNotice {
  date: DateKey;
  notified: boolean;
  dismissed?: boolean;
}

export function currentSleepNotice(repo: Repository, now = new Date()): SleepNotice | null {
  const ps = repo.planSettings();
  return sleepNotice(repo.measuredDays(), eveningDateKey(now), {
    window: ps.sleepWindow ?? null,
    sleepRoutine: sleepRoutineText(repo.contextOf('routine')),
  });
}

/** Today's notice, if any, saved once and sent once as a notification on the phone. */
export async function checkSleepNotice(repo: Repository, now = new Date(), opts: { quiet?: (now: Date) => boolean } = {}): Promise<StoredNotice | null> {
  const date = eveningDateKey(now);
  const stored = repo.kvGet(NOTICE_KEY) as StoredNotice | null | undefined;
  if (stored?.date === date) return stored;
  const notice = currentSleepNotice(repo, now);
  if (!notice) return null;
  const notified = opts.quiet?.(now) ? false : await notifyNow(`dagsljus-sleep-${date}`, notice.title, notice.body);
  const next: StoredNotice = { ...notice, date, notified };
  await repo.kvSet(NOTICE_KEY, next);
  return next;
}

export function todaysSleepNotice(repo: Repository, now = new Date()): StoredNotice | null {
  const stored = repo.kvGet(NOTICE_KEY) as StoredNotice | null | undefined;
  return stored && stored.date === eveningDateKey(now) && !stored.dismissed ? stored : null;
}
