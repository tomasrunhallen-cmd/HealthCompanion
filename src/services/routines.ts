// Saving the day's routine answers, ticked off on the home screen or in the check-in. The rules for routines are in plan/routines.ts.

import type { ContextEntry, DateKey } from '../core/domain/types';
import type { Repository } from '../storage/repository';

/** One answer per routine and evening; a new answer replaces the old. */
export async function setRoutineDone(repo: Repository, date: DateKey, routine: ContextEntry, done: boolean | null, notify = true): Promise<void> {
  const old = repo.contextOf('routine_done').filter((e) => e.date === date && e.routineId === routine.id);
  for (const [i, e] of old.entries()) await repo.removeContextEntry(e.id, notify && done == null && i === old.length - 1);
  if (done != null) await repo.addContextEntry({ kind: 'routine_done', text: routine.text, origin: 'user', date, routineId: routine.id, done }, notify);
}
