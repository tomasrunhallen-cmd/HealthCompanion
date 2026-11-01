// Första veckan: when the person started, and what has been answered.

import { eveningDateKey } from '../core/analysis/dates';
import { firstWeek, type FirstWeek } from '../core/analysis/firstWeek';
import type { Repository } from '../storage/repository';

/** Sets the start day once: today, or the earliest entry for someone who used the app before. */
export async function ensureFirstUse(repo: Repository, now = new Date()): Promise<void> {
  if (repo.settings().firstUseAt) return;
  const first = repo.entries()[0]?.date ?? eveningDateKey(now);
  await repo.updateSettings({ firstUseAt: first });
}

export function firstWeekState(repo: Repository, now = new Date()): FirstWeek | null {
  const s = repo.settings();
  const manual = Object.keys(repo.manualDays()).length > 0;
  return firstWeek(s.firstUseAt, eveningDateKey(now), {
    sleepSourceDismissed: !!s.firstWeekDone?.sleepSource,
    hasSleepSource: repo.garminStatus().connected || manual,
    weekPictureSeen: !!s.firstWeekDone?.weekPicture,
  });
}

export async function markFirstWeek(repo: Repository, part: 'sleepSource' | 'weekPicture'): Promise<void> {
  await repo.updateSettings({ firstWeekDone: { ...repo.settings().firstWeekDone, [part]: true } });
}
