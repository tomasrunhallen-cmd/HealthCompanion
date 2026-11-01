// Standard content from context/standard.md, for users who start without their own
// crisis plan. Standard rows only ever give yellow until the user confirms or replaces
// them (see levelFromSignals), and the app reminds weekly in the first four weeks. Loading
// and replacing the rows in the database: services/standard.ts.

import type { AppSettings, ContextKind } from '../domain/types';
import { parseFrontmatter } from '../prompts/loader';
import { CONTEXT_SOURCES } from '../prompts/bundle.generated';

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
