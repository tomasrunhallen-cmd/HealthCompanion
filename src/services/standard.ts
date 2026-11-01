// Standard content in the database: load it at first start, confirm a row, replace it with
// the user's own plan. Parsing and the weekly reminder rule are in context/standard.ts.

import { loadStandard } from '../core/context/standard';
import type { Repository } from '../storage/repository';

/** First start without an own plan: load the standard rows, unconfirmed. */
export async function startWithStandard(repo: Repository, now = new Date()): Promise<void> {
  if (!repo.contextEntries('grund').some((e) => e.origin === 'standard')) {
    for (const row of loadStandard().rows) {
      await repo.addContextEntry({ kind: row.kind, text: row.text, origin: 'standard', approvedAt: null }, false);
    }
  }
  await repo.updateSettings({ contextMode: 'standard', standardSince: now.toISOString(), standardNudgeDismissedWeek: null });
}

export function unconfirmedStandard(repo: Repository) {
  return repo.contextEntries('grund').filter((e) => e.origin === 'standard' && e.approvedAt == null);
}

/** The user keeps a standard row as their own. It can then give red like any other row. */
export async function confirmStandard(repo: Repository, id: string, now = new Date()): Promise<void> {
  await repo.updateContextEntry(id, { approvedAt: now.toISOString() });
}

/** When the user's own plan replaces the standard: unconfirmed standard rows are removed. */
export async function replaceStandard(repo: Repository): Promise<number> {
  const rows = unconfirmedStandard(repo);
  for (const e of rows) await repo.removeContextEntry(e.id, false);
  await repo.updateSettings({ contextMode: 'own' });
  return rows.length;
}
