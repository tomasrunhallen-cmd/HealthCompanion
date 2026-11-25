// Sleep phases from the watch: deep, light, REM and awake. Shown as background only. A wrist
// watch is fair at total sleep and at when sleep starts and ends, but much less sure about which
// phase is which, so the phases never count in the day's level.

import type { DateKey, MeasuredDay } from '../domain/types';

export type SleepPhase = 'deep' | 'light' | 'rem' | 'awake';

export const PHASE_ORDER: SleepPhase[] = ['deep', 'light', 'rem', 'awake'];

export const PHASE_WORD: Record<SleepPhase, string> = { deep: 'Djup', light: 'Lätt', rem: 'REM', awake: 'Vaken' };

export interface PhasePart {
  phase: SleepPhase;
  /** Null when the watch gave no value for this phase (often time awake): missing, never 0. */
  minutes: number | null;
  /** Share of the phases that have a value, 0–1; null when the phase is missing. */
  share: number | null;
  /** In a mean: how many nights had this phase. */
  nights?: number;
}

type PhaseDay = Pick<MeasuredDay, 'deepMinutes' | 'remMinutes' | 'lightMinutes' | 'awakeMinutes'>;

function minutesOf(d: PhaseDay, p: SleepPhase): number | null {
  const v = p === 'deep' ? d.deepMinutes : p === 'rem' ? d.remMinutes : p === 'light' ? d.lightMinutes : d.awakeMinutes;
  return typeof v === 'number' && v >= 0 ? v : null;
}

function withShares(parts: { phase: SleepPhase; minutes: number | null; nights?: number }[]): PhasePart[] {
  const total = parts.reduce((a, p) => a + (p.minutes ?? 0), 0);
  return parts.map((p) => ({ ...p, share: p.minutes == null || !total ? null : p.minutes / total }));
}

/**
 * The night's phases, or null when the watch gave no deep, light and REM sleep (older days have
 * only deep and REM). Time awake may be missing: it is then shown as missing, and the shares are
 * of the three sleep phases only.
 */
export function phasesOf(d: PhaseDay | null | undefined): PhasePart[] | null {
  if (!d) return null;
  const parts = PHASE_ORDER.map((phase) => ({ phase, minutes: minutesOf(d, phase) }));
  if (parts.some((p) => p.phase !== 'awake' && p.minutes == null)) return null;
  if (parts.reduce((a, p) => a + (p.minutes ?? 0), 0) <= 0) return null;
  return withShares(parts);
}

/** True when a phase is missing, so the shares are not of the whole night. */
export function incomplete(parts: PhasePart[]): boolean {
  return parts.some((p) => p.minutes == null);
}

/** "1 h 20 min", "45 min". */
export function minutesText(m: number): string {
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ''}` : `${r} min`;
}

/** "djup 1 h 20 min (18 %), …, vaken saknas": for a line of text and for the screen reader. */
export function phasesText(parts: PhasePart[]): string {
  return parts.map((p) => {
    const word = PHASE_WORD[p.phase].toLowerCase();
    return p.minutes == null ? `${word} saknas` : `${word} ${minutesText(p.minutes)} (${Math.round((p.share ?? 0) * 100)} %)`;
  }).join(', ');
}

/**
 * The mean night between two dates. Each phase is averaged over the nights that have it, never
 * with a missing value counted as 0, and says how many nights that was.
 */
export function meanPhases(days: Record<DateKey, MeasuredDay>, from: DateKey, to: DateKey): { parts: PhasePart[]; nights: number } | null {
  const nights = Object.entries(days).filter(([d]) => d >= from && d <= to).map(([, m]) => phasesOf(m)).filter((p): p is PhasePart[] => !!p);
  if (!nights.length) return null;
  const parts = PHASE_ORDER.map((phase) => {
    const values = nights.map((n) => n.find((x) => x.phase === phase)!.minutes).filter((v): v is number => v != null);
    return { phase, minutes: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null, nights: values.length };
  });
  return { parts: withShares(parts), nights: nights.length };
}
