// "Underlaget är tunt": what the day's level rests on when something is missing. A green day
// without sleep, or before the app knows the person's usual state, does not say as much as a
// full one, and the person should see that next to the level (granskning F02).

import type { Assessment, Entry } from '../domain/types';
import { RULES } from './rules';
import { wasStale } from './remeasure';
import { LEVEL_WORD } from './levelWords';

const NOT_KNOWN_YET = 'appen känner inte ditt vanliga läge än';

export function thinReasons(entry: Entry, a: Assessment): string[] {
  if (a.akut) return [];
  const out: string[] = [];
  // A green day says nothing about signs when the plan has none to compare the note with.
  if (a.inputs && a.inputs.signs.length === 0) out.push('din plan har inga tecken att jämföra med');
  if (entry.kind === 'checkin' && !entry.transcript.trim()) out.push('ingen anteckning');
  if (entry.sleepHours == null) out.push('sömn saknas');
  if (wasStale(entry)) out.push(`klockan hade bara synkat till ${entry.measuredUntil}`);
  if (a.stressMissingDays) out.push(`stressregeln kunde inte bedömas, ${a.stressMissingDays === 1 ? 'en dag saknar' : `${a.stressMissingDays} dagar saknar`} stress`);
  if (a.baseline.greenDays < RULES.baselineMinSamples) out.push(NOT_KNOWN_YET);
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

/**
 * A green day that rests on limited information: no signs in the plan, no note, missing sleep, a
 * lagging watch or a stress rule that could not be judged. Marked where colours are summed up
 * (Hem's week, Alla dagar, the visit report), so it is not read as a well-founded green. Not the
 * first weeks before the app knows the usual state: that would mark every early day. Never a
 * reason to raise the level or to ask for more.
 */
export function limitedGreen(entry: Entry, a: Assessment): boolean {
  return a.level === 'green' && thinReasons(entry, a).some((r) => r !== NOT_KNOWN_YET && !r.startsWith('med klockans senare värden'));
}
