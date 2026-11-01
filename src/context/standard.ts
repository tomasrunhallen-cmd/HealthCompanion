// Standard content from context/standard.md, for users who start without their own
// crisis plan. Standard rows only ever give yellow until the user confirms or replaces
// them (see levelFromSignals), and the app reminds weekly in the first four weeks.

import type { AppSettings, ContextKind } from '../domain/types';
import { parseFrontmatter } from '../prompts/loader';
import { CONTEXT_SOURCES } from '../prompts/bundle.generated';
import type { Repository } from '../storage/repository';

const HEADINGS: Record<string, ContextKind> = {
  'tidiga tecken': 'early',
  'allvarliga tecken': 'serious',
  'åtgärder vid gult': 'action_yellow',
  'åtgärder vid rött': 'action_red',
  'önskad ton vid gult': 'tone_yellow',
  'önskad ton vid rött': 'tone_red',
  'utlösare': 'trigger',
};

export interface StandardRow {
  kind: ContextKind;
  text: string;
}

export function parseStandard(source: string): { version: string; rows: StandardRow[] } {
  const { meta, body } = parseFrontmatter(source);
  const rows: StandardRow[] = [];
  let kind: ContextKind | null = null;
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      kind = HEADINGS[h[1].toLowerCase()] ?? null;
      continue;
    }
    const b = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (b && kind) rows.push({ kind, text: b[1] });
  }
  return { version: String(meta.version ?? ''), rows };
}

export function loadStandard(): { version: string; rows: StandardRow[] } {
  const src = CONTEXT_SOURCES['context/standard.md'];
  if (!src) throw new Error('context/standard.md saknas');
  return parseStandard(src);
}

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

export const NUDGE_WEEKS = 4;

/**
 * The week (1 to 4) in which to remind the user to replace standard content, or null.
 * One reminder per week, from a week after the start, as long as unconfirmed standard
 * rows remain and the user has not dismissed this week's reminder.
 */
export function standardNudgeWeek(
  settings: Pick<AppSettings, 'contextMode' | 'standardSince' | 'standardNudgeDismissedWeek'>,
  unconfirmedCount: number,
  now = new Date(),
): number | null {
  if (settings.contextMode !== 'standard' || !settings.standardSince || unconfirmedCount === 0) return null;
  const days = Math.floor((now.getTime() - new Date(settings.standardSince).getTime()) / 86_400_000);
  const week = Math.floor(days / 7);
  if (week < 1 || week > NUDGE_WEEKS) return null;
  if (settings.standardNudgeDismissedWeek != null && settings.standardNudgeDismissedWeek >= week) return null;
  return week;
}
