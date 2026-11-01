// Saving an upcoming event from the weekly question in the check-in.

import type { DateKey } from '../core/domain/types';
import type { Repository } from '../storage/repository';

export const ASKED_KEY = 'eventsAskedAt';

export async function addEvent(repo: Repository, text: string, date: DateKey): Promise<void> {
  if (!text.trim()) return;
  await repo.addContextEntry({ kind: 'event', text: text.trim(), origin: 'user', date });
}

export async function markEventsAsked(repo: Repository, today: DateKey): Promise<void> {
  await repo.kvSet(ASKED_KEY, today);
}

export function eventsAskedAt(repo: Repository): DateKey | null {
  return (repo.kvGet(ASKED_KEY) as DateKey | undefined) ?? null;
}
