// Deterministic scoring. Given today's entry, which plan signs matched, and the history,
// compute signals, points and level. Pure and fully testable.

import type {
  Assessment, Baseline, DateKey, Entry, Level, PlanItem, PlanSettings, Signal, SignMatch,
} from '../domain/types';
import { addDays, daysBetween } from './dates';
import { RULES } from './rules';

export interface HistoryDay {
  entry: Entry;
  /** Level of the assessment for this entry, if any. */
  level: Level | null;
}

export interface ScoreInput {
  entry: Entry;
  matches: SignMatch[];
  plan: PlanItem[];
  planSettings: PlanSettings;
  /** Earlier entries with their levels. Entries on or after entry.date are ignored. */
  history: HistoryDay[];
}

export interface ScoreResult {
  level: Level;
  points: number;
  signals: Signal[];
  baseline: Baseline;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Baselines from green days in the last 28 days before `date`. */
export function computeBaseline(date: DateKey, history: HistoryDay[]): Baseline {
  const from = addDays(date, -RULES.baselineWindowDays);
  const green = history.filter(
    (h) => h.level === 'green' && h.entry.date >= from && h.entry.date < date,
  );
  const wpm = green.map((h) => h.entry.wordsPerMinute).filter((v): v is number => v != null);
  const stress = green.map((h) => h.entry.stressAvg).filter((v): v is number => v != null);
  return {
    wordsPerMinute: wpm.length >= RULES.baselineMinSamples ? Math.round(mean(wpm)!) : null,
    stressAvg: stress.length >= RULES.baselineMinSamples ? round1(mean(stress)!) : null,
    greenDays: green.length,
  };
}

/** Number of whole days without any entry right before `date`. */
export function silentDaysBefore(date: DateKey, history: HistoryDay[]): number {
  const earlier = history.filter((h) => h.entry.date < date).map((h) => h.entry.date);
  if (earlier.length === 0) return 0; // no history yet: a new user is not silent
  const last = earlier.reduce((a, b) => (a > b ? a : b));
  return Math.max(0, daysBetween(last, date) - 1);
}

/**
 * Whole days without an entry before today, for the home screen. Today does not count
 * until it is over, so this matches what the next assessment will see.
 */
export function silentDaysUntil(today: DateKey, entries: Entry[]): number {
  if (entries.length === 0) return 0;
  const last = entries.map((e) => e.date).reduce((a, b) => (a > b ? a : b));
  if (last >= today) return 0;
  return Math.max(0, daysBetween(last, today) - 1);
}

export function levelFromSignals(
  signals: Signal[],
  recentNonGreenDays: number,
): { level: Level; points: number } {
  const points = signals.reduce((sum, s) => sum + s.points, 0);
  const L = RULES.level;
  const serious = signals.some((s) => s.kind === 'serious_sign');
  const measuredCount = signals.filter((s) => s.measured).length;
  // "Ett allvarligt tecken matchar tillsammans med minst ett annat tecken".
  const seriousPlusOther = serious && signals.length >= 2;
  const red =
    points >= L.redAt ||
    seriousPlusOther ||
    (points >= L.redWithHistoryAt && recentNonGreenDays >= L.historyNonGreenDays) ||
    measuredCount >= L.redMeasuredSigns;
  if (red) return { level: 'red', points };
  if (points >= L.yellowAt) return { level: 'yellow', points };
  return { level: 'green', points };
}

function entryHour(entry: Entry): number {
  return new Date(entry.createdAt).getHours();
}

export function score(input: ScoreInput): ScoreResult {
  const { entry, matches, plan, planSettings } = input;
  const history = input.history.filter((h) => h.entry.date < entry.date && h.entry.id !== entry.id);
  const signals: Signal[] = [];
  const byId = new Map(plan.map((p) => [p.id, p]));

  // Signs from the user's own plan that matched the note.
  for (const m of matches) {
    const item = byId.get(m.planItemId);
    if (!item || (item.kind !== 'early' && item.kind !== 'serious')) continue;
    if (signals.some((s) => s.planItemId === item.id)) continue;
    signals.push({
      kind: item.kind === 'early' ? 'early_sign' : 'serious_sign',
      points: item.kind === 'early' ? RULES.points.earlySign : RULES.points.seriousSign,
      label: item.text,
      planItemId: item.id,
      quote: m.quote,
      measured: false,
    });
  }

  // Sleep under the plan's threshold. Two nights in a row count as two.
  if (entry.sleepHours != null && entry.sleepHours < planSettings.sleepThresholdHours) {
    const src = entry.sleepSource === 'transcript' ? ' (skattat ur anteckningen)' : '';
    signals.push({
      kind: 'sleep_low',
      points: RULES.points.measured,
      label: `Sömn ${entry.sleepHours} h, under din gräns på ${planSettings.sleepThresholdHours} h${src}`,
      measured: true,
    });
    const yesterday = history.find((h) => h.entry.date === addDays(entry.date, -1));
    if (
      yesterday?.entry.sleepHours != null &&
      yesterday.entry.sleepHours < planSettings.sleepThresholdHours
    ) {
      signals.push({
        kind: 'sleep_low_consecutive',
        points: RULES.points.measured,
        label: 'Andra natten i rad med kort sömn',
        measured: true,
      });
    }
  }

  const baseline = computeBaseline(entry.date, history);

  if (entry.stressAvg != null && baseline.stressAvg != null &&
      entry.stressAvg > baseline.stressAvg * RULES.stressFactor) {
    signals.push({
      kind: 'stress_high',
      points: RULES.points.measured,
      label: `Stress ${entry.stressAvg} mot ditt vanliga ${baseline.stressAvg}`,
      measured: true,
    });
  }

  if (entry.wordsPerMinute != null && baseline.wordsPerMinute != null &&
      entry.wordsPerMinute > baseline.wordsPerMinute * (1 + RULES.speechFastFraction)) {
    signals.push({
      kind: 'speech_fast',
      points: RULES.points.measured,
      label: `${entry.wordsPerMinute} ord per minut mot ditt vanliga ${baseline.wordsPerMinute}`,
      measured: true,
    });
  }

  if (entry.kind === 'checkin' && entryHour(entry) < RULES.nightEntryEndHour) {
    signals.push({
      kind: 'night_entry',
      points: RULES.points.measured,
      label: 'Inlägget gjordes mitt i natten',
      measured: true,
    });
  }

  const silent = silentDaysBefore(entry.date, history);
  if (silent >= RULES.silenceDays) {
    signals.push({
      kind: 'silence',
      points: RULES.points.silence,
      label: `${silent} dagar utan inlägg innan i dag`,
      measured: true,
    });
  }

  // Jumps in mood or energy against the last 7 days. One point if either jumps.
  const from = addDays(entry.date, -RULES.jumpWindowDays);
  const window = history.filter((h) => h.entry.date >= from);
  const jump = (key: 'mood' | 'energy'): number | null => {
    const today = entry[key];
    if (today == null) return null;
    const vals = window.map((h) => h.entry[key]).filter((v): v is number => v != null);
    if (vals.length < RULES.jumpMinSamples) return null;
    const avg = mean(vals)!;
    return Math.abs(today - avg) >= RULES.jumpThreshold ? round1(today - avg) : null;
  };
  const moodJump = jump('mood');
  const energyJump = jump('energy');
  if (moodJump != null || energyJump != null) {
    const parts: string[] = [];
    if (moodJump != null) parts.push(`stämning ${moodJump > 0 ? '+' : ''}${moodJump}`);
    if (energyJump != null) parts.push(`energi ${energyJump > 0 ? '+' : ''}${energyJump}`);
    signals.push({
      kind: moodJump != null ? 'mood_jump' : 'energy_jump',
      points: RULES.points.jump,
      label: `Stort hopp mot snittet för sju dagar: ${parts.join(', ')}`,
      measured: true,
    });
  }

  if (entry.kind === 'heavy') {
    signals.push({
      kind: 'heavy_day',
      points: RULES.points.heavyDay,
      label: 'Du loggade dagen som tung',
      measured: false,
    });
  }

  const recentFrom = addDays(entry.date, -RULES.level.historyWindowDays);
  const recentNonGreen = new Set(
    history
      .filter((h) => h.entry.date >= recentFrom && (h.level === 'yellow' || h.level === 'red'))
      .map((h) => h.entry.date),
  ).size;

  const { level, points } = levelFromSignals(signals, recentNonGreen);
  return { level, points, signals, baseline };
}

/** Builds history pairs from stored entries and assessments. */
export function buildHistory(entries: Entry[], assessments: Assessment[]): HistoryDay[] {
  const byEntry = new Map(assessments.map((a) => [a.entryId, a.level]));
  return entries.map((entry) => ({ entry, level: byEntry.get(entry.id) ?? null }));
}
