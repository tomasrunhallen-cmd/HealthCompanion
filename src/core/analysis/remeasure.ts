// When the watch syncs late. A check-in saves sleep and stress as Garmin has them at that
// moment; if the watch had not synced for hours, the day's values were incomplete. When later
// values differ, the day can be computed again with them. The signs from the note are kept
// (no model is asked again); only the measured values change. Nothing is saved here: the
// caller saves silently when the level and points stay, and asks the person when they change.

import type { Assessment, DateKey, Entry, Level, MeasuredDay, PlanItem, PlanSettings } from '../domain/types';
import { DAY_START_HOUR } from './dates';
import { GREEN_SENTENCE, templateSentence } from './assess';
import { recomputeAssessment } from './recompute';
import type { HistoryDay } from './scoring';
import { sleepSourceOf, stressSourceOf } from './sources';

/** A gap this long between the watch's last reading and the check-in means it had not synced. */
export const STALE_MINUTES = 120;

function minutes(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

/**
 * How many minutes the watch's last reading lies before a clock time on the same evening.
 * The evening runs to 04:00, so 01:00 is after 23:00. Null when either time is unknown.
 */
export function minutesBehind(until: string | null | undefined, at: string | null | undefined): number | null {
  if (!until || !at) return null;
  let a = minutes(at);
  if (a < DAY_START_HOUR * 60) a += 24 * 60;
  return Math.max(0, a - minutes(until));
}

/** The watch had not synced for a while when the check-in was saved. */
export function wasStale(entry: Entry): boolean {
  const gap = minutesBehind(entry.measuredUntil, entry.localTime);
  return gap != null && gap >= STALE_MINUTES;
}

const dec = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** What differs between the values the assessment used and the values there are now, in words. */
export function measuredChanges(entry: Entry, a: Assessment, now: MeasuredDay | null): string[] {
  if (!now || entry.kind === 'imported') return [];
  const out: string[] = [];
  if (now.sleepHours != null && entry.sleepSource !== 'manual' && (entry.sleepHours == null || Math.abs(now.sleepHours - entry.sleepHours) >= 0.1)) {
    out.push(entry.sleepHours == null
      ? `Sömn ${dec(now.sleepHours)} h (saknades)`
      : `Sömn ${dec(now.sleepHours)} h (förut ${dec(entry.sleepHours)} h${entry.sleepSource === 'transcript' ? ', skattat ur anteckningen' : ''})`);
  }
  if (now.stressAvg != null && entry.stressSource !== 'manual' && now.stressAvg !== entry.stressAvg) {
    out.push(entry.stressAvg == null ? `Stress ${now.stressAvg} (saknades)` : `Stress ${now.stressAvg} (förut ${entry.stressAvg})`);
  }
  const before = a.inputs?.garmin[entry.date]?.sleepStart ?? null;
  if (a.inputs && now.sleepStart && now.sleepStart !== before && now.sleepHours != null) {
    out.push(before ? `Somnade ${now.sleepStart} (förut ${before})` : `Somnade ${now.sleepStart} (saknades)`);
  }
  return out;
}

export interface Remeasured {
  entry: Entry;
  assessment: Assessment;
  before: { level: Level; points: number };
  after: { level: Level; points: number };
  changes: string[];
  /** The level or the points change: the person is asked first. */
  matters: boolean;
}

export interface RemeasureContext {
  /** The days before this one, with their levels. */
  history: HistoryDay[];
  plan: PlanItem[];
  planSettings: PlanSettings;
  measured: Record<DateKey, MeasuredDay>;
  medication: Record<DateKey, boolean>;
}

/** The day computed again with the values there are now, or null when nothing differs. */
export function remeasure(entry: Entry, a: Assessment, ctx: RemeasureContext, at = new Date()): Remeasured | null {
  const m = ctx.measured[entry.date] ?? null;
  const changes = measuredChanges(entry, a, m);
  if (!m || !changes.length) return null;

  const sleepFromWatch = m.sleepHours != null && entry.sleepSource !== 'manual';
  const stressFromWatch = m.stressAvg != null && entry.stressSource !== 'manual';
  const next: Entry = {
    ...entry,
    sleepHours: sleepFromWatch ? m.sleepHours : entry.sleepHours,
    sleepSource: sleepFromWatch ? sleepSourceOf(m) : entry.sleepSource,
    stressAvg: stressFromWatch ? m.stressAvg : entry.stressAvg,
    stressSource: stressFromWatch ? stressSourceOf(m) : entry.stressSource,
    measuredUntil: m.dataUntil ?? entry.measuredUntil ?? null,
  };
  // The saved inputs with the new day; the days before stay as they were.
  const withDay: Assessment = a.inputs ? { ...a, inputs: { ...a.inputs, garmin: { ...a.inputs.garmin, [entry.date]: m } } } : a;
  const computed = recomputeAssessment(withDay, next, ctx.history.filter((h) => h.entry.date < entry.date), {
    plan: ctx.plan,
    planSettings: ctx.planSettings,
    garmin: ctx.measured,
    medication: ctx.medication,
  }, at);
  // The sentence follows the level; a sentence from the model is kept while the level stays.
  const sentence = a.akut
    ? a.sentence
    : computed.level === 'green'
      ? GREEN_SENTENCE
      : computed.level === a.level
        ? a.sentence
        : templateSentence(computed.signals);
  const assessment: Assessment = {
    ...computed,
    sentence,
    recomputed: a.recomputed ?? null,
    remeasured: { at: at.toISOString(), level: a.level, points: a.points, changes },
  };
  return {
    entry: next,
    assessment,
    before: { level: a.level, points: a.points },
    after: { level: assessment.level, points: assessment.points },
    changes,
    matters: assessment.level !== a.level || assessment.points !== a.points,
  };
}

/** A short key for the values a choice was made on, so "Behåll" holds until the values change again. */
export function measuredKey(changes: string[]): string {
  return changes.join('|');
}
