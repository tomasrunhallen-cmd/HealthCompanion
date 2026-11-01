// Saving the answers to "Gjorde du något av stegen?" after a red day.

import type { DateKey } from '../core/domain/types';
import type { Repository } from '../storage/repository';

export async function setRedStep(repo: Repository, redDay: DateKey, step: string, done: boolean | null): Promise<void> {
  const old = repo.contextOf('red_step').filter((e) => e.date === redDay && e.text === step);
  for (const [i, e] of old.entries()) await repo.removeContextEntry(e.id, done == null && i === old.length - 1);
  if (done != null) await repo.addContextEntry({ kind: 'red_step', text: step, origin: 'user', date: redDay, done });
}
