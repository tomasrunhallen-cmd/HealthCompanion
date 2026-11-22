// Deterministic scoring. Given today's entry, which plan signs matched, and the history,
// compute signals, points and level. Pure and fully testable.

import type {
  TextObservationInput, RhythmScoreInput,
  Assessment, Baseline, DateKey, Entry, GarminDay, Level, LevelReason, MeasureSource, PlanItem, PlanSettings, Signal, SignalKind, SignMatch,
} from '../domain/types';
import { addDays, daysBetween, entryClock, weekStart } from './dates';
import { RULES } from './rules';
import { moodStep } from './mood';

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
  /** The check-in's medication answer per evening: true taken, false not taken. Unanswered days are absent. */
  medication?: Record<DateKey, boolean>;
  /** Mina tidigare texter: observations of approved personal patterns that passed the checks on the phone. */
  textObservations?: TextObservationInput[];
  /** Dygnsrytm for the day (experimental). Counted only when `use` is set. */
  rhythm?: RhythmScoreInput | null;
}

/** What became of one personal text observation in the rules. */
export interface TextOutcome {
  patternId: string;
  quote: string;
  counted: boolean;
  reason: string | null;
}

export interface ScoreResult {
  /** Neutral trend lines, see trendLines. Never points. */
  trend: string[];
  level: Level;
  points: number;
  reason: LevelReason;
  recentNonGreenDays: number;
  signals: Signal[];
  baseline: Baseline;
  /** Mina tidigare texter: what each observation did, and the level the day would have had without them. */
  textOutcomes: TextOutcome[];
  withoutText: { level: Level; points: number; reason: LevelReason };
  /** Dygnsrytm: the level with and without the signal, whether or not it was used. Null without an estimate. */
  rhythm: { signal: Signal | null; with: { level: Level; points: number }; without: { level: Level; points: number }; used: boolean } | null;
  /**
   * Days of the stress run without a value, when the days that had one were all at or above the
   * limit: the stress rule could have given a sign but could not be judged. 0 otherwise.
   */
  stressMissingDays: number;
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
function minutesAfterNoon(entry: Pick<Entry, 'createdAt' | 'localTime'>): number {
  const { hour, minute } = entryClock(entry);
  return (hour * 60 + minute - 720 + 1440) % 1440;
}

function clock(minutesAfterNoonValue: number): string {
  const total = (Math.round(minutesAfterNoonValue) + 720) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Baselines from green days in the 28 days before the Monday of `date`'s week. They are
 * recomputed once a week, so a whole week is judged against the same baseline. Pure code.
 */
export function computeBaseline(date: DateKey, history: HistoryDay[], stressSource: MeasureSource = 'garmin'): Baseline {
  const monday = weekStart(date);
  const from = addDays(monday, -RULES.baselineWindowDays);
  // Only full green days: a day without sleep, or after alcohol, illness or hard training, says
  // little about the person's usual state (granskning F02).
  const green = history.filter(
    (h) => h.level === 'green' && h.entry.date >= from && h.entry.date < monday &&
      h.entry.sleepHours != null && !h.entry.strainYesterday,
  );
  const enough = (v: number[]) => v.length >= RULES.baselineMinSamples;
  const wpm = green.map((h) => h.entry.wordsPerMinute).filter((v): v is number => v != null);
  // Stress is compared only with stress from the same source: an own estimate is not on Garmin's scale.
  const stress = green.filter((h) => (h.entry.stressSource ?? 'garmin') === stressSource).map((h) => h.entry.stressAvg).filter((v): v is number => v != null);
  const sleep = green.map((h) => h.entry.sleepHours).filter((v): v is number => v != null);
  const times = green.filter((h) => h.entry.kind === 'checkin').map((h) => minutesAfterNoon(h.entry));
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

/** Measured signs under the daily cap. Night entries and silence are not among them. */
export const CAPPED_KINDS: SignalKind[] = ['sleep_low', 'sleep_low_consecutive', 'stress_high', 'late_sleep_no_entry', 'speech_fast'];
/** Signs that count as 0 after alcohol, illness or hard training the day before: every measured sleep sign and stress. */
export const EXCUSABLE_KINDS: SignalKind[] = ['sleep_low', 'sleep_low_consecutive', 'stress_high', 'late_sleep_no_entry'];

/**
 * Level from signals. Yellow uses every point. Red is judged only on signals that may give
 * red: not unconfirmed standard rows, and not measured signs that were not there the day
 * before. A day that would be red only through those becomes yellow.
 */
export function levelFromSignals(
  signals: Signal[],
  recentNonGreenDays: number,
): { level: Level; points: number; reason: LevelReason } {
  const result = levelBeforeTextRule(signals, recentNonGreenDays);
  // Personal text patterns may lift a day with other signs to red, never make it red alone:
  // not through points, the serious-plus-other rule or the recent-days rule.
  if (result.level === 'red' && !RULES.textPatterns.aloneCanGiveRed) {
    const others = signals.filter((s) => s.kind !== 'text_pattern' && s.points > 0);
    if (!others.length) return { level: 'yellow', points: result.points, reason: 'text_alone' };
  }
  return result;
}

function levelBeforeTextRule(
  signals: Signal[],
  recentNonGreenDays: number,
): { level: Level; points: number; reason: LevelReason } {
  const all = rawLevel(signals, recentNonGreenDays);
  if (all.level !== 'red') return all;
  // Signs that may give yellow but never red on their own: unconfirmed standard rows, measured
  // signs that were not there the day before, and (by default) measured signs with a possible
  // explanation from yesterday. Red needs red without them.
  const firstDay = (s: Signal) => CAPPED_KINDS.includes(s.kind) && !s.persistent;
  const excused = (s: Signal) => !!s.excused && !RULES.excusedMeasuredToRed;
  const firm = rawLevel(signals.filter((s) => !s.unconfirmedStandard && !firstDay(s) && !excused(s)), recentNonGreenDays);
  if (firm.level === 'red') return { ...firm, points: all.points };
  const noStandard = signals.filter((s) => !s.unconfirmedStandard);
  if (rawLevel(noStandard, recentNonGreenDays).level !== 'red') return { level: 'yellow', points: all.points, reason: 'standard_cap' };
  const noExcused = noStandard.filter((s) => !excused(s));
  return { level: 'yellow', points: all.points, reason: rawLevel(noExcused, recentNonGreenDays).level === 'red' ? 'measured_first_day' : 'excused' };
}

function rawLevel(
  signals: Signal[],
  recentNonGreenDays: number,
): { level: Level; points: number; reason: LevelReason } {
  const counted = signals.filter((s) => s.points > 0);
  const points = counted.reduce((sum, s) => sum + s.points, 0);
  const L = RULES.level;
  const serious = counted.some((s) => s.kind === 'serious_sign' || s.serious);
  // "Ett allvarligt tecken matchar tillsammans med minst ett annat tecken".
  const seriousPlusOther = serious && counted.length >= L.seriousPlusOtherSigns;
  // The first rule that applies is the one shown to the user.
  if (points >= L.redAt) return { level: 'red', points, reason: 'points_red' };
  if (seriousPlusOther) return { level: 'red', points, reason: 'serious_plus_other' };
  if (points >= L.redWithHistoryAt && recentNonGreenDays >= L.historyNonGreenDays) {
    return { level: 'red', points, reason: 'recent_days' };
  }
  if (points >= L.yellowAt) return { level: 'yellow', points, reason: 'points' };
  return { level: 'green', points, reason: 'nothing' };
}

/** One day's stress and where it came from. */
type StressDay = { v: number; source: MeasureSource };

/** The limit for high stress on a source's own scale (rules 1.8.0): manual "Hög" is its own step. */
const stressLimit = (source: MeasureSource) => (source === 'manual' ? RULES.stressHighAtManual : RULES.stressHighAt);

/**
 * The stress of the `RULES.stressHighDays` days ending on `end`, oldest first, null for a day
 * without a value. The watch first, then the entry; `endValue` (and `endSource`) for the last
 * day when given.
 */
function stressDays(end: DateKey, history: HistoryDay[], garmin: Record<DateKey, GarminDay>, endValue?: number | null, endSource?: MeasureSource | null): (StressDay | null)[] {
  const n = RULES.stressHighDays;
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(end, i - (n - 1));
    if (i === n - 1 && endValue !== undefined) return endValue == null ? null : { v: endValue, source: endSource ?? 'garmin' };
    const g = garmin[d];
    if (g?.stressAvg != null) return { v: g.stressAvg, source: g.stressSource ?? g.source ?? 'garmin' };
    const e = history.find((h) => h.entry.date === d)?.entry;
    return e?.stressAvg != null ? { v: e.stressAvg, source: e.stressSource ?? 'garmin' } : null;
  });
}

/** The run when every day has a value from one and the same source, else null: scales are not mixed. */
function stressRun(end: DateKey, history: HistoryDay[], garmin: Record<DateKey, GarminDay>, endValue?: number | null, endSource?: MeasureSource | null): StressDay[] | null {
  const days = stressDays(end, history, garmin, endValue, endSource);
  if (days.some((d) => d == null)) return null;
  const run = days as StressDay[];
  return run.every((d) => d.source === run[0].source) ? run : null;
}

/**
 * The days of the stress run that have no value, counted only when the rule is relevant: at
 * least one day has a value and every value there is at or above its source's limit. A day
 * missing when stress was low anyway says nothing.
 */
export function stressGap(end: DateKey, history: HistoryDay[], garmin: Record<DateKey, GarminDay>, endValue?: number | null, endSource?: MeasureSource | null): number {
  const days = stressDays(end, history, garmin, endValue, endSource);
  const present = days.filter((d): d is StressDay => d != null);
  const missing = days.length - present.length;
  return missing > 0 && present.length > 0 && present.every((d) => d.v >= stressLimit(d.source)) ? missing : 0;
}

/** Stress at or above the source's limit every day of a one-source run. */
const stressHigh = (run: StressDay[] | null): run is StressDay[] => !!run && run.every((d) => d.v >= stressLimit(d.source));

/** Which capped measured signs were there the day before, from yesterday's entry and Garmin. */
function yesterdaysMeasured(
  date: DateKey,
  history: HistoryDay[],
  garmin: Record<DateKey, GarminDay>,
  planSettings: PlanSettings,
  baseline: Baseline,
): Set<SignalKind> {
  const out = new Set<SignalKind>();
  const yDate = addDays(date, -1);
  const yEntry = history.find((h) => h.entry.date === yDate)?.entry;
  const yG = garmin[yDate];
  const excused = !!yEntry?.strainYesterday;
  const sleep = yG?.sleepHours ?? yEntry?.sleepHours ?? null;
  if (!excused && sleep != null && sleep < planSettings.sleepThresholdHours) {
    out.add('sleep_low');
    out.add('sleep_low_consecutive');
  }
  if (!excused && stressHigh(stressRun(yDate, history, garmin))) out.add('stress_high');
  if (yG?.sleepStart) {
    const h = Number(yG.sleepStart.slice(0, 2));
    if (h >= RULES.lateSleepHour && h < RULES.lateSleepLatestHour && !history.some((x) => x.entry.date === addDays(yDate, -1))) {
      out.add('late_sleep_no_entry');
    }
  }
  if (yEntry?.wordsPerMinute != null && baseline.wordsPerMinute != null &&
      yEntry.wordsPerMinute > baseline.wordsPerMinute * (1 + RULES.speechFastFraction)) out.add('speech_fast');
  return out;
}

/**
 * Applies, in order: the excuse (alcohol, illness or hard training yesterday puts sleep,
 * late sleep and stress at 0), the mark for signs that persisted from the day before, and the daily cap
 * on measured signs.
 */
function adjustMeasured(signals: Signal[], entry: Entry, yesterday: Set<SignalKind>): Signal[] {
  let used = 0;
  return signals.map((s) => {
    if (!CAPPED_KINDS.includes(s.kind)) return s;
    let next: Signal = { ...s, persistent: yesterday.has(s.kind) };
    // A possible explanation, not a reason to hide what was measured: it still counts, towards yellow.
    if (entry.strainYesterday && EXCUSABLE_KINDS.includes(s.kind)) {
      next = { ...next, excused: true, label: `${s.label}, möjlig förklaring: alkohol, sjuk eller hård träning i går` };
    }
    if (next.points > 0) {
      const room = Math.max(0, RULES.measuredCapPerDay - used);
      if (next.points > room) {
        next = { ...next, points: room, capped: true, label: `${next.label}, räknas inte: mätta tecken ger högst ${RULES.measuredCapPerDay} poäng per dag` };
      }
      used += next.points;
    }
    return next;
  });
}

function entryHour(entry: Entry): number {
  return entryClock(entry).hour;
}

const WORD: Record<number, string> = { 2: 'två', 3: 'tre', 4: 'fyra', 5: 'fem', 6: 'sex', 7: 'sju' };
const nWord = WORD[RULES.trendDays] ?? String(RULES.trendDays);
export const TREND_SLEEP = `Din sömn har blivit kortare ${nWord} nätter i rad.`;
export const TREND_STRESS = `Din stress har ökat ${nWord} dagar i rad.`;

/**
 * Sleep shorter, or stress higher, three days in a row while still within the limit:
 * one neutral line each, for green days. Gives no points and no colour. Garmin first,
 * then the entry, for each of the two earlier days.
 */
export function trendLines(
  entry: Entry,
  history: HistoryDay[],
  garmin: Record<DateKey, GarminDay>,
  planSettings: PlanSettings,
  baseline: Baseline,
): string[] {
  const day = (offset: number) => {
    const d = addDays(entry.date, -offset);
    return { g: garmin[d], e: history.find((h) => h.entry.date === d)?.entry };
  };
  const n = RULES.trendDays;
  const series = (pick: (g: GarminDay | undefined, e: Entry | undefined) => number | null | undefined, today: number | null) => {
    const vals = [...Array.from({ length: n - 1 }, (_, i) => pick(day(n - 1 - i).g, day(n - 1 - i).e)), today];
    return vals.every((v) => v != null) ? (vals as number[]) : null;
  };
  const falling = (v: number[]) => v.every((x, i) => i === 0 || v[i - 1] > x);
  const rising = (v: number[]) => v.every((x, i) => i === 0 || v[i - 1] < x);
  const out: string[] = [];
  const sleep = series((g, e) => g?.sleepHours ?? e?.sleepHours, entry.sleepHours);
  if (sleep && falling(sleep) && sleep[n - 1] >= planSettings.sleepThresholdHours) out.push(TREND_SLEEP);
  const stress = series((g, e) => g?.stressAvg ?? e?.stressAvg, entry.stressAvg);
  if (stress && rising(stress) && !stressHigh(stressRun(entry.date, history, garmin, entry.stressAvg, entry.stressSource))) out.push(TREND_STRESS);
  return out;
}

/** Word stems that make a plan sign one about sleep (rules 1.8.0; the sign's own words only since 1.8.1). */
const SLEEP_STEMS = ['sov', 'sömn', 'somn', 'vak', 'natt', 'nätt', 'insomn'];
export const aboutSleep = (text: string) => {
  const t = text.toLowerCase();
  return SLEEP_STEMS.some((st) => new RegExp(`(^|[^a-zåäö])${st}`).test(t) || (st === 'sömn' && t.includes(st)));
};

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

  // Sleep under the plan's threshold. Two nights in a row count as two. When a sign from the
  // plan about sleep already matched, the first short night is that same sign measured and
  // gives no point of its own (rules 1.8.0); the second night in a row still counts.
  if (entry.sleepHours != null && entry.sleepHours < planSettings.sleepThresholdHours) {
    const src = entry.sleepSource === 'transcript' ? ' (skattat ur anteckningen)' : '';
    // Whether a sign is about sleep is read from the plan's sign alone, never from the quote: the
    // quote's length follows how the note was written, and the points must not (granskning 22 november).
    const viaSign = signals.some((s) => (s.kind === 'early_sign' || s.kind === 'serious_sign') && aboutSleep(s.label));
    signals.push({
      kind: 'sleep_low',
      points: viaSign ? 0 : RULES.points.measured,
      label: `Sömn ${sv(entry.sleepHours)} h, under din gräns på ${sv(planSettings.sleepThresholdHours)} h${src}${viaSign ? ', räknas redan genom ditt tecken' : ''}`,
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

  const baseline = computeBaseline(entry.date, history, entry.stressSource ?? 'garmin');

  // Stress at or above the limit several days in a row; one high day is not a sign.
  // One source for the whole run (rules 1.8.0): the label says which.
  const stressRunDays = stressRun(entry.date, history, garmin, entry.stressAvg, entry.stressSource);
  if (stressHigh(stressRunDays)) {
    const days = `${WORD[RULES.stressHighDays] ?? RULES.stressHighDays} dagar i rad`;
    const src = stressRunDays[0].source;
    signals.push({
      kind: 'stress_high',
      points: RULES.points.measured,
      label: src === 'manual'
        ? `Du angav hög stress ${days}`
        : `Stress ${RULES.stressHighAt} eller mer ${days}${src === 'health' ? ' enligt Apple Hälsa eller Health Connect' : ''} (${stressRunDays.map((d) => d.v).join(', ')})`,
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

  // Fell asleep after 02:00 by the watch, and no entry the evening before.
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

  // Medication not taken, by the user's own answer, yesterday and today.
  const med = input.medication ?? {};
  const missedDays = Array.from({ length: RULES.medicationMissedDays }, (_, i) => addDays(entry.date, -i));
  if (missedDays.every((d) => med[d] === false)) {
    signals.push({
      kind: 'medication_missed',
      points: RULES.points.medicationMissed,
      label: RULES.medicationMissedDays === 2 ? 'Medicin inte tagen i går och i dag' : `Medicin inte tagen ${RULES.medicationMissedDays} dagar i rad`,
      measured: false,
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
    const threshold = key === 'mood' ? RULES.moodJumpThreshold : RULES.jumpThreshold;
    return Math.abs(today - avg) >= threshold ? round1(today - avg) : null;
  };
  // A jump in the direction the person rated (±2 or more) is the same thing seen twice: counted once.
  const rawMoodJump = jump('mood');
  const moodJump = rawMoodJump != null && entry.mood != null && Math.abs(entry.mood) >= 2 && Math.sign(rawMoodJump) === Math.sign(entry.mood) ? null : rawMoodJump;
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

  // Stämning rated away from balance: ±2 and ±3 are a sign in the direction they point.
  if (entry.mood != null && Math.abs(entry.mood) >= 2) {
    const step = moodStep(entry.mood);
    signals.push({
      kind: 'mood_rated',
      points: Math.abs(entry.mood) >= 3 ? RULES.points.moodSevere : RULES.points.moodModerate,
      label: `Du skattade stämningen som ${step.label.toLowerCase()}`,
      measured: false,
      polarity: entry.mood > 0 ? 'up' : 'down',
      // ±3 weighs as a serious sign: the plan's steps at red show.
      ...(Math.abs(entry.mood) >= 3 ? { serious: true } : {}),
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

  const measuredAndPlan = adjustMeasured(signals, entry, yesterdaysMeasured(entry.date, history, garmin, planSettings, baseline));
  const withoutText = levelFromSignals(measuredAndPlan, recentNonGreen);
  const { signals: textSignals, outcomes: textOutcomes } = textPatternSignals(input.textObservations ?? [], measuredAndPlan);
  const withText = [...measuredAndPlan, ...textSignals];
  const before = levelFromSignals(withText, recentNonGreen);
  const rhythmSignal = input.rhythm ? rhythmSignalFor(input.rhythm, withText) : null;
  const tried = rhythmSignal ? withRhythm([...withText, rhythmSignal], before, recentNonGreen) : before;
  const used = !!(input.rhythm?.use && rhythmSignal && rhythmSignal.points > 0);
  const adjusted = used ? [...withText, rhythmSignal!] : rhythmSignal ? [...withText, { ...rhythmSignal, points: 0 }] : withText;
  const { level, points, reason } = used ? tried : before;
  const trend = trendLines(entry, history, garmin, planSettings, baseline);
  const rhythm = input.rhythm
    ? { signal: rhythmSignal, with: { level: tried.level, points: tried.points }, without: { level: before.level, points: before.points }, used }
    : null;
  const stressMissingDays = stressGap(entry.date, history, garmin, entry.stressAvg, entry.stressSource);
  return { level, points, reason, recentNonGreenDays: recentNonGreen, signals: adjusted, baseline, trend, textOutcomes, withoutText, rhythm, stressMissingDays };
}

// ---- Dygnsrytm (experimental) ----

const SLEEP_KINDS: SignalKind[] = ['sleep_low', 'sleep_low_consecutive'];

/**
 * The passive signal: a change that resembles the run-up to an earlier period gives
 * RULES.rhythm.points. A change that resembles nothing, a stable rhythm or too little data gives
 * nothing and never lowers anything.
 * Short sleep that the sleep rule already counted today is counted once.
 */
export function rhythmSignalFor(r: RhythmScoreInput, others: Signal[]): Signal | null {
  if (r.status !== 'change') return null;
  // Context the person added is shown, and saved with the day. It does not dismiss the signal (rules 1.6.0).
  const base = { kind: 'rhythm' as const, measured: true, label: `Dygnsrytm: ${r.text}${r.context ? ` Sammanhang du lagt till: ${r.context}.` : ''}` };
  if (r.direction !== 'up' && r.direction !== 'down') return { ...base, points: 0, label: `${base.label} Räknas inte: det liknar ingen tidigare period.` };
  const onlySleepLength = r.patterns.every((p) => p === 'shorter');
  if (onlySleepLength && others.some((s) => SLEEP_KINDS.includes(s.kind) && s.points > 0)) {
    return { ...base, points: 0, polarity: r.direction, label: `${base.label} Räknas inte en gång till: den korta sömnen räknas redan.` };
  }
  return { ...base, points: RULES.rhythm.points, polarity: r.direction };
}

/** The level with the passive signal. It may lift a level but never decide red on its own. */
function withRhythm(signals: Signal[], before: { level: Level; points: number; reason: LevelReason }, recentNonGreen: number): { level: Level; points: number; reason: LevelReason } {
  const after = levelFromSignals(signals, recentNonGreen);
  if (after.level === 'red' && before.level !== 'red' && !RULES.rhythm.aloneCanGiveRed) return { level: 'yellow', points: after.points, reason: 'passive_cap' };
  // Never lower what the other signs gave.
  if (LEVEL_RANK[after.level] < LEVEL_RANK[before.level]) return before;
  return after;
}

const LEVEL_RANK: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

// ---- Mina tidigare texter ----

/** The measured or rated signals that are the same phenomenon as a personal text pattern. */
const SAME_PHENOMENON: Partial<Record<TextObservationInput['phenomenon'], SignalKind[]>> = {
  sleep: ['sleep_low', 'sleep_low_consecutive', 'late_sleep_no_entry'],
  mood: ['mood_rated', 'mood_jump'],
  speech: ['speech_fast'],
  activity: ['energy_jump'],
};

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-zåäöéü0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/** Two quotes overlap when they share three words in a row, or one holds the other. */
function overlaps(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b).join(' ');
  if (!x.length || !y) return false;
  if (y.includes(x.join(' ')) || x.join(' ').includes(y)) return true;
  for (let i = 0; i + 3 <= x.length; i++) if (` ${y} `.includes(` ${x.slice(i, i + 3).join(' ')} `)) return true;
  return false;
}

/**
 * Personal text patterns as signals. One point each, at most the daily cap, from distinct
 * patterns, phenomena and quotes. Never when the same thing already counts as a plan sign or a
 * measured or rated value: when in doubt, no extra point. They never weigh as serious.
 */
export function textPatternSignals(observations: TextObservationInput[], others: Signal[]): { signals: Signal[]; outcomes: TextOutcome[] } {
  const T = RULES.textPatterns;
  const counted = others.filter((s) => s.points > 0);
  const signals: Signal[] = [];
  const outcomes: TextOutcome[] = [];
  const skip = (o: TextObservationInput, reason: string) => outcomes.push({ patternId: o.patternId, quote: o.quote, counted: false, reason });
  for (const o of observations) {
    if (o.planSignId && others.some((s) => s.planItemId === o.planSignId)) { skip(o, 'Samma som ett tecken ur din plan, som redan räknas'); continue; }
    if (counted.some((s) => s.planItemId && s.quote && overlaps(o.quote, s.quote))) { skip(o, 'Samma ord som ett tecken ur din plan, som redan räknas'); continue; }
    const same = SAME_PHENOMENON[o.phenomenon] ?? [];
    if (counted.some((s) => same.includes(s.kind))) { skip(o, 'Samma sak som ett mätt eller skattat värde, som redan räknas'); continue; }
    if (signals.some((s) => s.patternId === o.patternId)) { skip(o, 'Samma mönster räknas en gång om dagen'); continue; }
    const earlier = observations.filter((x) => signals.some((s) => s.patternId === x.patternId));
    if (earlier.some((x) => x.phenomenon === o.phenomenon)) { skip(o, 'Samma fenomen som ett annat mönster i dag'); continue; }
    if (signals.some((s) => s.quote && overlaps(o.quote, s.quote))) { skip(o, 'Samma citat som ett annat mönster i dag'); continue; }
    // During the first clinical evaluation the pattern is shown, never counted (rules 1.9.0).
    if (!RULES.experimentalInLevel) { skip(o, 'Visas bara: under den första kliniska utvärderingen räknas experimentella signaler inte in i färgen'); continue; }
    if (signals.length * T.points + T.points > T.capPerDay) { skip(o, `Högst ${T.capPerDay} poäng om dagen från dina tidigare texter`); continue; }
    signals.push({
      kind: 'text_pattern',
      points: T.points,
      label: `Mönster ur dina tidigare texter: ${o.description}`,
      quote: o.quote,
      measured: false,
      patternId: o.patternId,
      ...(o.direction === 'up' || o.direction === 'down' ? { polarity: o.direction } : {}),
    });
    outcomes.push({ patternId: o.patternId, quote: o.quote, counted: true, reason: null });
  }
  return { signals, outcomes };
}

/** Builds history pairs from stored entries and assessments. */
export function buildHistory(entries: Entry[], assessments: Assessment[]): HistoryDay[] {
  const byEntry = new Map(assessments.map((a) => [a.entryId, a.level]));
  return entries.map((entry) => ({ entry, level: byEntry.get(entry.id) ?? null }));
}
