// Deterministic scoring. Given today's entry, which plan signs matched, and the history,
// compute signals, points and level. Pure and fully testable.

import type {
  Assessment, Baseline, DateKey, Entry, GarminDay, Level, LevelReason, PlanItem, PlanSettings, Signal, SignMatch,
} from '../domain/types';
import { addDays, daysBetween, weekStart } from './dates';
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
  /** Measured days from Garmin, keyed by calendar date. Optional. */
  garmin?: Record<DateKey, GarminDay>;
}

export interface ScoreResult {
  level: Level;
  points: number;
  reason: LevelReason;
  recentNonGreenDays: number;
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

/** Swedish decimal comma for labels shown to the user. */
function sv(n: number): string {
  return String(round1(n)).replace('.', ',');
}

/** Minutes after noon, so that 21:00 and 01:15 average to a late evening, not to midday. */
function minutesAfterNoon(iso: string): number {
  const d = new Date(iso);
  return (d.getHours() * 60 + d.getMinutes() - 720 + 1440) % 1440;
}

function clock(minutesAfterNoonValue: number): string {
  const total = (Math.round(minutesAfterNoonValue) + 720) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Baselines from green days in the 28 days before the Monday of `date`'s week. They are
 * recomputed once a week, so a whole week is judged against the same baseline. Pure code.
 */
export function computeBaseline(date: DateKey, history: HistoryDay[]): Baseline {
  const monday = weekStart(date);
  const from = addDays(monday, -RULES.baselineWindowDays);
  const green = history.filter(
    (h) => h.level === 'green' && h.entry.date >= from && h.entry.date < monday,
  );
  const enough = (v: number[]) => v.length >= RULES.baselineMinSamples;
  const wpm = green.map((h) => h.entry.wordsPerMinute).filter((v): v is number => v != null);
  const stress = green.map((h) => h.entry.stressAvg).filter((v): v is number => v != null);
  const sleep = green.map((h) => h.entry.sleepHours).filter((v): v is number => v != null);
  const times = green.filter((h) => h.entry.kind === 'checkin').map((h) => minutesAfterNoon(h.entry.createdAt));
  return {
    wordsPerMinute: enough(wpm) ? Math.round(mean(wpm)!) : null,
    stressAvg: enough(stress) ? round1(mean(stress)!) : null,
    greenDays: green.length,
    sleepHours: enough(sleep) ? round1(mean(sleep)!) : null,
    entryTime: enough(times) ? clock(mean(times)!) : null,
    weekOf: monday,
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

/**
 * Level from signals. Unconfirmed standard rows may give yellow but never red: red is
 * judged without them, and a day that would only be red because of them becomes yellow.
 */
export function levelFromSignals(
  signals: Signal[],
  recentNonGreenDays: number,
): { level: Level; points: number; reason: LevelReason } {
  const all = rawLevel(signals, recentNonGreenDays);
  if (all.level !== 'red' || !signals.some((s) => s.unconfirmedStandard)) return all;
  const firm = rawLevel(signals.filter((s) => !s.unconfirmedStandard), recentNonGreenDays);
  if (firm.level === 'red') return { ...firm, points: all.points };
  return { level: 'yellow', points: all.points, reason: 'standard_cap' };
}

function rawLevel(
  signals: Signal[],
  recentNonGreenDays: number,
): { level: Level; points: number; reason: LevelReason } {
  const points = signals.reduce((sum, s) => sum + s.points, 0);
  const L = RULES.level;
  const serious = signals.some((s) => s.kind === 'serious_sign');
  const measuredCount = signals.filter((s) => s.measured).length;
  // "Ett allvarligt tecken matchar tillsammans med minst ett annat tecken".
  const seriousPlusOther = serious && signals.length >= 2;
  // The first rule that applies is the one shown to the user.
  if (points >= L.redAt) return { level: 'red', points, reason: 'points_red' };
  if (seriousPlusOther) return { level: 'red', points, reason: 'serious_plus_other' };
  if (measuredCount >= L.redMeasuredSigns) return { level: 'red', points, reason: 'measured_three' };
  if (points >= L.redWithHistoryAt && recentNonGreenDays >= L.historyNonGreenDays) {
    return { level: 'red', points, reason: 'recent_days' };
  }
  if (points >= L.yellowAt) return { level: 'yellow', points, reason: 'points' };
  return { level: 'green', points, reason: 'nothing' };
}

function entryHour(entry: Entry): number {
  return new Date(entry.createdAt).getHours();
}

export function score(input: ScoreInput): ScoreResult {
  const { entry, matches, plan, planSettings } = input;
  const garmin = input.garmin ?? {};
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
      ...(item.origin === 'standard' && item.approvedAt == null ? { unconfirmedStandard: true } : {}),
    });
  }

  // Sleep under the plan's threshold. Two nights in a row count as two.
  if (entry.sleepHours != null && entry.sleepHours < planSettings.sleepThresholdHours) {
    const src = entry.sleepSource === 'transcript' ? ' (skattat ur anteckningen)' : '';
    signals.push({
      kind: 'sleep_low',
      points: RULES.points.measured,
      label: `Sömn ${sv(entry.sleepHours)} h, under din gräns på ${sv(planSettings.sleepThresholdHours)} h${src}`,
      measured: true,
    });
    // Yesterday's sleep from Garmin when there is no entry, so a silent day still counts.
    const yDate = addDays(entry.date, -1);
    const ySleep = garmin[yDate]?.sleepHours ?? history.find((h) => h.entry.date === yDate)?.entry.sleepHours ?? null;
    if (ySleep != null && ySleep < planSettings.sleepThresholdHours) {
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

  // Fell asleep after 02:00 by the watch, and no entry the evening before: two signs.
  const start = garmin[entry.date]?.sleepStart;
  if (start) {
    const hour = Number(start.slice(0, 2));
    const noEntryBefore = !history.some((h) => h.entry.date === addDays(entry.date, -1));
    if (hour >= RULES.lateSleepHour && hour < RULES.lateSleepLatestHour && noEntryBefore) {
      signals.push({
        kind: 'late_sleep_no_entry',
        points: RULES.points.lateSleepNoEntry,
        label: `Somnade ${start} enligt klockan, utan inlägg kvällen innan`,
        measured: true,
      });
    }
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

  const { level, points, reason } = levelFromSignals(signals, recentNonGreen);
  return { level, points, reason, recentNonGreenDays: recentNonGreen, signals, baseline };
}

/** Builds history pairs from stored entries and assessments. */
export function buildHistory(entries: Entry[], assessments: Assessment[]): HistoryDay[] {
  const byEntry = new Map(assessments.map((a) => [a.entryId, a.level]));
  return entries.map((entry) => ({ entry, level: byEntry.get(entry.id) ?? null }));
}
