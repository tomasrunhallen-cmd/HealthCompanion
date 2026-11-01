// Saving the evening's routine answers. The rules for routines are in plan/routines.ts.

import type { ContextEntry, DateKey } from '../core/domain/types';
import type { Repository } from '../storage/repository';

/** One answer per routine and evening; a new answer replaces the old. */
export async function setRoutineDone(repo: Repository, date: DateKey, routine: ContextEntry, done: boolean | null): Promise<void> {
  for (const old of repo.contextOf('routine_done').filter((e) => e.date === date && e.routineId === routine.id)) {
    await repo.removeContextEntry(old.id, false);
  }
  if (done != null) await repo.addContextEntry({ kind: 'routine_done', text: routine.text, origin: 'user', date, routineId: routine.id, done }, false);
}
