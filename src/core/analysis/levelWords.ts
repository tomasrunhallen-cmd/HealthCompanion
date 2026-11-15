import type { Level } from '../domain/types';

/** The level as a word inside a sentence: "dagen hade blivit gul". */
export const LEVEL_WORD: Record<Level, string> = { green: 'grön', yellow: 'gul', red: 'röd' };

/**
 * The week's counts in words for Hem: "5 gröna dagar, 1 gul, 1 dag utan avstämning". The first
 * level and the days without a check-in carry the noun, so "utan" never stands alone.
 */
export function weekCounts(counts: { green: number; yellow: number; red: number }, missing: number, limitedGreen = 0): string {
  const word = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const levels = [
    counts.green ? word(counts.green, 'grön', 'gröna') : null,
    counts.yellow ? word(counts.yellow, 'gul', 'gula') : null,
    counts.red ? word(counts.red, 'röd', 'röda') : null,
  ].filter((x): x is string => !!x);
  if (levels.length) levels[0] = `${levels[0]} ${/^1 /.test(levels[0]) ? 'dag' : 'dagar'}`;
  // A green day on limited information, said next to the green days: not a well-founded green.
  if (counts.green && limitedGreen) levels[0] = `${levels[0]} (${counts.green === 1 ? 'med' : `${limitedGreen} med`} begränsat underlag)`;
  if (missing) levels.push(`${word(missing, 'dag', 'dagar')} utan avstämning`);
  return levels.join(', ');
}
