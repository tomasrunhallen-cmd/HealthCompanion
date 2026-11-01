// "Räkna om historiken med nya regler": the difference first, saved only on approval.

import { recomputeHistory, type RecomputedDay } from '../core/analysis/recompute';
import type { DateKey } from '../core/domain/types';
import type { Repository } from '../storage/repository';

export function previewRecompute(repo: Repository, now = new Date()): RecomputedDay[] {
  const medication: Record<DateKey, boolean> = {};
  for (const e of repo.contextOf('medication_taken')) if (e.date && e.taken != null) medication[e.date] = e.taken;
  return recomputeHistory(repo.entries(), repo.assessments(), {
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    garmin: repo.allGarminDays(),
    medication,
  }, now);
}

/** Saves every recomputed day, so all of them carry the current rules version. */
export async function applyRecompute(repo: Repository, days: RecomputedDay[]): Promise<number> {
  await repo.saveAssessments(days.map((d) => d.next));
  return days.filter((d) => d.changed).length;
}
