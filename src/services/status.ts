// Senaste veckan at the top of Hem: what the code needs, read from what is saved. Pure reading,
// no language model and nothing stored, so the card follows a new check-in at once
// (core/plan/status.ts, granskning 26 november).

import { addDays, eveningDateKey } from '../core/analysis/dates';
import { frequencyOf } from '../core/plan/routineFrequency';
import { countedRoutineIds } from '../core/plan/routines';
import type { StatusInput } from '../core/plan/status';
import type { Repository } from '../storage/repository';

export function statusInput(repo: Repository, now = new Date()): StatusInput {
  const today = eveningDateKey(now);
  const from = addDays(today, -13);
  const stopped = new Set(repo.assessments().filter((a) => a.akut).map((a) => a.entryId));
  const days = repo.history()
    .filter((h) => h.entry.date >= from && h.entry.date <= today)
    .map((h) => ({ date: h.entry.date, level: h.level, akut: stopped.has(h.entry.id) }));
  const ctx = repo.contextEntries();
  const ids = countedRoutineIds(ctx, repo.settings().planMode ?? null, from, today);
  const routineOf = new Map(ctx.filter((e) => e.kind === 'routine').map((e) => [e.id, e]));
  const answers = ctx.filter((e) => e.kind === 'routine_done' && e.date && e.date >= from && e.date <= today && e.done != null);
  return {
    today,
    days,
    routines: ids.map((id) => routineOf.get(id)).filter((r): r is NonNullable<typeof r> => !!r?.text).map((r) => ({ id: r.id, text: r.text, frequency: frequencyOf(r) })),
    ticks: answers.filter((e) => e.done && e.routineId).map((e) => ({ date: e.date!, routineId: e.routineId! })),
    answeredDates: answers.map((e) => e.date!),
    events: ctx.filter((e) => e.kind === 'event' && e.date).map((e) => ({ date: e.date!, text: e.text })),
    upward: repo.settings().planMode?.direction === 'up',
  };
}
