// Saving the day's routine answers, ticked off on the home screen or in the check-in. The rules for routines are in plan/routines.ts.

import type { ContextEntry, DateKey } from '../core/domain/types';
import { renameLine } from '../core/plan/blocks';
import type { Repository } from '../storage/repository';
import { planBlocks, saveBlock } from './planBlocks';

/** One answer per routine and evening; a new answer replaces the old. */
export async function setRoutineDone(repo: Repository, date: DateKey, routine: ContextEntry, done: boolean | null, notify = true): Promise<void> {
  const old = repo.contextOf('routine_done').filter((e) => e.date === date && e.routineId === routine.id);
  for (const [i, e] of old.entries()) await repo.removeContextEntry(e.id, notify && done == null && i === old.length - 1);
  if (done != null) await repo.addContextEntry({ kind: 'routine_done', text: routine.text, origin: 'user', date, routineId: routine.id, done }, notify);
}

/**
 * New words for a routine. The plan stays the source: the line changes in its part of the plan,
 * and the routine keeps its id, so its settings (how often, reminder) and its history stay.
 */
export async function renameRoutine(repo: Repository, routine: ContextEntry, text: string): Promise<ContextEntry | null> {
  const words = text.replace(/\s+/g, ' ').trim();
  if (!words || words === routine.text) return null;
  const block = planBlocks(repo).find((b) => b.id === routine.blockId) ?? planBlocks(repo).find((b) => b.type === 'routine' && renameLine(b.text, routine.text, words) != null);
  const next = block ? renameLine(block.text, routine.text, words) : null;
  const finalWords = words.charAt(0).toUpperCase() + words.slice(1);
  // The entry first, so that saving the block finds it again by its new words.
  await repo.updateContextEntry(routine.id, { text: finalWords, origin: 'user' }, !block);
  if (block && next != null) await saveBlock(repo, { ...block, text: next });
  return repo.contextOf('routine').find((e) => e.id === routine.id) ?? null;
}
