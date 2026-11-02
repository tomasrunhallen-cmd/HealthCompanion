// Stämning on a bipolar scale from −3 to +3, from depression through balance to mania. The
// steps follow the self-rating used in the MONARCA trials (Faurholt-Jepsen et al.), where the
// patient rates mood each evening from −3 (depressive) to +3 (manic). How severe a step is
// follows the NIMH Life Chart Method: by how much the mood gets in the way of daily life.
// The names are the person's own words for the states, as in the Swedish diary Bipolär dagbok.

import type { Polarity } from '../domain/types';

export const MOOD_MIN = -3;
export const MOOD_MAX = 3;

export interface MoodStep {
  value: number;
  label: string;
  /** What the step means, by how daily life goes. */
  hint: string;
}

export const MOOD_SCALE: readonly MoodStep[] = [
  { value: -3, label: 'Akut depression', hint: 'Klarar inte vardagen' },
  { value: -2, label: 'Depression', hint: 'Svårt att klara vardagen' },
  { value: -1, label: 'Nedstämdhet', hint: 'Lägre än vanligt, klarar vardagen' },
  { value: 0, label: 'Balanserad', hint: 'Som vanligt' },
  { value: 1, label: 'Glädje', hint: 'Högre än vanligt, klarar vardagen' },
  { value: 2, label: 'Uppvarvning', hint: 'Svårt att bromsa, vardagen påverkas' },
  { value: 3, label: 'Akut mani', hint: 'Klarar inte vardagen' },
];

export function moodStep(value: number): MoodStep {
  const v = Math.max(MOOD_MIN, Math.min(MOOD_MAX, Math.round(value)));
  return MOOD_SCALE[v - MOOD_MIN];
}

/** "Nedstämdhet (−1)", for the explanation and reports. */
export function moodText(value: number): string {
  const s = moodStep(value);
  return `${s.label} (${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(s.value)})`;
}

/** Which way the rating points, for the plan's actions. */
export function moodPolarity(value: number): Polarity | null {
  return value > 0 ? 'up' : value < 0 ? 'down' : null;
}

/**
 * The old 1–10 mood ("1 Mycket låg" to "10 Mycket hög") on the new scale, for entries saved
 * before it. The same axis, low to high: 5 and 6 are balanced, 1 and 10 the ends.
 */
export function moodFromTen(value: number): number {
  return Math.max(MOOD_MIN, Math.min(MOOD_MAX, Math.round((value - 5.5) * (2 / 3)))) || 0;
}
