// Sleep phases from the watch: deep, light, REM and awake. Shown as background only. A wrist
// watch is fair at total sleep and at when sleep starts and ends, but much less sure about which
// phase is which, so the phases never count in the day's level.

import type { DateKey, MeasuredDay } from '../domain/types';

export type SleepPhase = 'deep' | 'light' | 'rem' | 'awake';

export const PHASE_ORDER: SleepPhase[] = ['deep', 'light', 'rem', 'awake'];

export const PHASE_WORD: Record<SleepPhase, string> = { deep: 'Djup', light: 'Lätt', rem: 'REM', awake: 'Vaken' };

export interface PhasePart {
  phase: SleepPhase;
  minutes: number;
  /** Share of the night (all four phases), 0–1. */
  share: number;
}

type PhaseDay = Pick<MeasuredDay, 'deepMinutes' | 'remMinutes' | 'lightMinutes' | 'awakeMinutes'>;

function minutesOf(d: PhaseDay, p: SleepPhase): number | null {
  const v = p === 'deep' ? d.deepMinutes : p === 'rem' ? d.remMinutes : p === 'light' ? d.lightMinutes : d.awakeMinutes;
  return typeof v === 'number' && v >= 0 ? v : null;
}

/** The night's phases, or null when the watch gave no deep, light and REM sleep (older days have only deep and REM). */
export function phasesOf(d: PhaseDay | null | undefined): PhasePart[] | null {
  if (!d) return null;
  const mins = PHASE_ORDER.map((p) => ({ phase: p, minutes: minutesOf(d, p) }));
  if (['deep', 'light', 'rem'].some((p) => mins.find((m) => m.phase === p)!.minutes == null)) return null;
  const total = mins.reduce((a, m) => a + (m.minutes ?? 0), 0);
  if (total <= 0) return null;
  return mins.map((m) => ({ phase: m.phase, minutes: m.minutes ?? 0, share: (m.minutes ?? 0) / total }));
}

/** "1 h 20 min", "45 min". */
export function minutesText(m: number): string {
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ''}` : `${r} min`;
}

/** "djup 1 h 20 min (18 %), lätt …": for a line of text and for the screen reader. */
export function phasesText(parts: PhasePart[]): string {
  return parts.map((p) => `${PHASE_WORD[p.phase].toLowerCase()} ${minutesText(p.minutes)} (${Math.round(p.share * 100)} %)`).join(', ');
}

/** The mean night over the nights that have phases between two dates, and how many nights it rests on. */
export function meanPhases(days: Record<DateKey, MeasuredDay>, from: DateKey, to: DateKey): { parts: PhasePart[]; nights: number } | null {
  const nights = Object.entries(days).filter(([d]) => d >= from && d <= to).map(([, m]) => phasesOf(m)).filter((p): p is PhasePart[] => !!p);
  if (!nights.length) return null;
  const mean = PHASE_ORDER.map((phase) => nights.reduce((a, n) => a + n.find((x) => x.phase === phase)!.minutes, 0) / nights.length);
  const total = mean.reduce((a, b) => a + b, 0);
  return { parts: PHASE_ORDER.map((phase, i) => ({ phase, minutes: Math.round(mean[i]), share: total ? mean[i] / total : 0 })), nights: nights.length };
}
