// Today's and the past week's measured sleep and stress, as plain Swedish text for the
// analys prompt. The model gets them as background for its sentence; the level is still
// computed in scoring.ts. Measured values (own entry, Garmin, health app) win over values
// estimated from the note, and every value that is not from Garmin says where it came from.

import type { Baseline, DateKey, Entry, GarminDay, MeasureSource, SleepSource } from '../domain/types';
import { SOURCE_TEXT, sleepSourceOf, stressSourceOf } from './sources';
import { addDays, formatDateSv } from './dates';
import type { HistoryDay } from './scoring';

export const NO_MEASUREMENTS = 'Inga mätvärden finns för i dag eller veckan innan.';

export interface PromptDay {
  date: DateKey;
  sleepHours: number | null;
  sleepSource: SleepSource | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  stressAvg: number | null;
  stressSource: MeasureSource | null;
  stressHighMinutes: number | null;
  bodyBatteryWake: number | null;
}

function dayFor(date: DateKey, entry: Entry | undefined, g: GarminDay | undefined): PromptDay {
  const garminSleep = g?.sleepHours ?? null;
  return {
    date,
    sleepHours: garminSleep ?? entry?.sleepHours ?? null,
    sleepSource: garminSleep != null ? sleepSourceOf(g) : entry?.sleepSource ?? null,
    sleepStart: g?.sleepStart ?? null,
    sleepEnd: g?.sleepEnd ?? null,
    deepMinutes: g?.deepMinutes ?? null,
    remMinutes: g?.remMinutes ?? null,
    stressAvg: g?.stressAvg ?? entry?.stressAvg ?? null,
    stressSource: g?.stressAvg != null ? stressSourceOf(g) : entry?.stressAvg != null ? entry.stressSource ?? 'garmin' : null,
    stressHighMinutes: g?.stressHighMinutes ?? null,
    bodyBatteryWake: g?.bodyBatteryWake ?? null,
  };
}

/** The entry's day and the `days` days before it, newest first. */
export function measuredDays(
  entry: Entry,
  history: HistoryDay[],
  garmin: Record<DateKey, GarminDay> = {},
  days = 7,
): PromptDay[] {
  const out: PromptDay[] = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(entry.date, -i);
    const e = i === 0 ? entry : history.find((h) => h.entry.date === date)?.entry;
    out.push(dayFor(date, e, garmin[date]));
  }
  return out;
}

function dec(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function hasAny(d: PromptDay): boolean {
  return d.sleepHours != null || d.stressAvg != null || d.bodyBatteryWake != null;
}

function sleepText(d: PromptDay, detailed: boolean): string | null {
  if (d.sleepHours == null) return null;
  const parts = [`${dec(d.sleepHours)} h`];
  if (d.sleepSource === 'transcript') parts[0] += ' (skattat ur anteckningen, inte mätt)';
  else if (d.sleepSource && d.sleepSource !== 'garmin') parts[0] += ` (${SOURCE_TEXT[d.sleepSource]})`;
  if (d.sleepStart) parts.push(`somnade ${d.sleepStart}`);
  if (detailed && d.sleepEnd) parts.push(`vaknade ${d.sleepEnd}`);
  if (detailed && d.deepMinutes != null) parts.push(`djupsömn ${d.deepMinutes} min`);
  if (detailed && d.remMinutes != null) parts.push(`REM ${d.remMinutes} min`);
  return parts.join(', ');
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function formatMeasurements(days: PromptDay[], baseline: number | Partial<Baseline> | null = null): string {
  const b: Partial<Baseline> = typeof baseline === 'number' ? { stressAvg: baseline } : baseline ?? {};
  const stressBaseline = b.stressAvg ?? null;
  if (!days.some(hasAny)) return NO_MEASUREMENTS;
  const [today, ...week] = days;
  const lines: string[] = ['Värdena är mätta av personens klocka (Garmin) om inget annat står.', ''];

  lines.push(`I dag, ${formatDateSv(today.date)}:`);
  const sleep = sleepText(today, true);
  lines.push(`- Sömn natten innan: ${sleep ?? 'saknas'}`);
  if (today.bodyBatteryWake != null) lines.push(`- Body Battery vid uppvaknandet: ${today.bodyBatteryWake} av 100`);
  lines.push(
    today.stressAvg != null
      ? `- Stress hittills i dag: snitt ${today.stressAvg} av 100${today.stressSource && today.stressSource !== 'garmin' ? ` (${SOURCE_TEXT[today.stressSource]})` : ''}${today.stressHighMinutes != null ? `, hög stress ${today.stressHighMinutes} min` : ''}`
      : '- Stress i dag: saknas',
  );

  lines.push('', 'Veckan innan:');
  for (const d of week) {
    const parts: string[] = [];
    const s = sleepText(d, false);
    if (s) parts.push(`sömn ${s}`);
    if (d.stressAvg != null) parts.push(`stress ${d.stressAvg}`);
    lines.push(`- ${formatDateSv(d.date)}: ${parts.length ? parts.join(', ') : 'inga mätvärden'}`);
  }

  const weekSleep = mean(week.filter((d) => d.sleepSource != null && d.sleepSource !== 'transcript').map((d) => d.sleepHours!).filter((v) => v != null));
  const weekStress = mean(week.map((d) => d.stressAvg).filter((v): v is number => v != null));
  const summary: string[] = [];
  if (weekSleep != null) summary.push(`sömn ${dec(weekSleep)} h`);
  if (weekStress != null) summary.push(`stress ${dec(weekStress)}`);
  if (summary.length) lines.push('', `Snitt veckan innan: ${summary.join(', ')}.`);
  if (stressBaseline != null) lines.push(`Personens vanliga stress på gröna dagar: ${dec(stressBaseline)}.`);
  if (b.sleepHours != null) lines.push(`Personens vanliga sömn på gröna dagar: ${dec(b.sleepHours)} h.`);
  if (b.entryTime) lines.push(`Personens vanliga tid för kvällens inlägg: ${b.entryTime}.`);
  return lines.join('\n');
}
