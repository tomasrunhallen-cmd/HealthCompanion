// Values the watch synced after the check-in: computes recent days again with them. A day
// whose level and points stay is updated at once, so its values are right. A day whose level
// or points would change is shown to the person, who chooses. Older days than the sync window
// are left as they are.

import { addDays, eveningDateKey } from '../core/analysis/dates';
import { measuredKey, remeasure, wasStale, type Remeasured } from '../core/analysis/remeasure';
import type { DateKey } from '../core/domain/types';
import type { Repository } from '../storage/repository';
import { SYNC_DAYS } from './garmin';

export const KEPT_KEY = 'remeasureKept';

function medication(repo: Repository): Record<DateKey, boolean> {
  const out: Record<DateKey, boolean> = {};
  for (const e of repo.contextOf('medication_taken')) if (e.date && e.taken != null) out[e.date] = e.taken;
  return out;
}

/** One day with the values there are now; null when nothing differs or the entry is gone. */
export function remeasureEntry(repo: Repository, entryId: string, now = new Date()): Remeasured | null {
  const entry = repo.entries().find((e) => e.id === entryId);
  const a = entry ? repo.assessmentFor(entry.id) : null;
  if (!entry || !a || entry.kind === 'imported') return null;
  return remeasure(entry, a, {
    history: repo.history(),
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    measured: repo.measuredDays(),
    medication: medication(repo),
  }, now);
}

function kept(repo: Repository): Record<string, string> {
  return (repo.kvGet(KEPT_KEY) as Record<string, string> | null | undefined) ?? {};
}

/** The person chose the values as they were for this day; asked again only if the values change again. */
export function isKept(repo: Repository, r: Remeasured): boolean {
  return kept(repo)[r.entry.id] === measuredKey(r.changes);
}

/**
 * Days in the sync window that were saved while the watch lagged, or without values, and
 * now have other values. A check-in on time is not touched: its stress was the day so far.
 */
export function laggingDays(repo: Repository, now = new Date()): Remeasured[] {
  const today = eveningDateKey(now);
  const from = addDays(today, -SYNC_DAYS);
  const out: Remeasured[] = [];
  for (const e of repo.entries()) {
    if (e.date < from || e.date > today || e.kind === 'imported') continue;
    if (!wasStale(e) && e.stressAvg != null && e.sleepSource !== 'transcript' && e.sleepHours != null) continue;
    const r = remeasureEntry(repo, e.id, now);
    if (r) out.push(r);
  }
  return out.sort((a, b) => a.entry.date.localeCompare(b.entry.date));
}

export async function applyRemeasure(repo: Repository, r: Remeasured): Promise<void> {
  await repo.saveEntry(r.entry, r.assessment);
}

export async function keepAsItWas(repo: Repository, r: Remeasured, now = new Date()): Promise<void> {
  await repo.kvSet(KEPT_KEY, { ...kept(repo), [r.entry.id]: measuredKey(r.changes) });
  // The day keeps its level, but says what the later values would have given.
  const a = repo.assessmentFor(r.entry.id);
  if (a && r.matters) await repo.saveAssessments([{ ...a, remeasureDeclined: { at: now.toISOString(), level: r.after.level, points: r.after.points } }]);
}

/** The person asked for the values again: a day they kept as it was may be shown again. */
export async function forgetKept(repo: Repository, entryId: string): Promise<void> {
  const { [entryId]: _dropped, ...rest } = kept(repo);
  void _dropped;
  await repo.kvSet(KEPT_KEY, rest);
}

/** After a sync: updates the days whose level stays, and returns those the person should see. */
export async function afterSync(repo: Repository, now = new Date()): Promise<Remeasured[]> {
  const ask: Remeasured[] = [];
  for (const r of laggingDays(repo, now)) {
    if (!r.matters) await applyRemeasure(repo, r);
    else if (!isKept(repo, r)) ask.push(r);
  }
  return ask;
}

/** Days waiting for the person's choice, for the card on Hem. */
export function remeasurePending(repo: Repository, now = new Date()): Remeasured[] {
  return laggingDays(repo, now).filter((r) => r.matters && !isKept(repo, r));
}
