// "Underlaget är tunt": what the day's level rests on when something is missing. A green day
// without sleep, or before the app knows the person's usual state, does not say as much as a
// full one, and the person should see that next to the level (granskning F02).

import type { Assessment, Entry } from '../domain/types';
import { RULES } from './rules';
import { wasStale } from './remeasure';
import { LEVEL_WORD } from './levelWords';

export function thinReasons(entry: Entry, a: Assessment): string[] {
  if (a.akut) return [];
  const out: string[] = [];
  if (entry.kind === 'checkin' && !entry.transcript.trim()) out.push('ingen anteckning');
  if (entry.sleepHours == null) out.push('sömn saknas');
  if (wasStale(entry)) out.push(`klockan hade bara synkat till ${entry.measuredUntil}`);
  if (a.baseline.greenDays < RULES.baselineMinSamples) out.push('appen känner inte ditt vanliga läge än');
  if (a.remeasureDeclined && a.remeasureDeclined.level !== a.level) {
    out.push(`med klockans senare värden hade dagen blivit ${LEVEL_WORD[a.remeasureDeclined.level]}`);
  }
  return out;
}

/** One line for the result: "Underlaget är tunt: sömn saknas, …". Null when nothing is missing. */
export function thinLine(entry: Entry, a: Assessment): string | null {
  const r = thinReasons(entry, a);
  return r.length ? `Underlaget är tunt: ${r.join(', ')}.` : null;
}
