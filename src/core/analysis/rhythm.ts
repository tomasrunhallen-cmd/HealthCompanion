// Dygnsrytm (experimental): a passive model that looks for early signs of a possible coming
// mood episode in sleep timing and activity over the day, from the watch alone. It needs no note
// and no check-in, and a missed check-in is never evidence. Everything is computed on the phone.
//
// The hypothesis under test: "möjlig episodstart inom tre dygn". Lee et al. found that digital
// measures of the circadian rhythm helped predict an episode start within three days; Ludwig et
// al. got clearly weaker results with another method. So the model is simple and says two
// separate things:
//   1. What actually changed, against the person's own earlier nights (robust z: median, MAD).
//   2. Whether the person's own history supports a direction (up or down), counting how often
//      the same pattern was there before documented episode starts AND during stable periods.
// It never gives a percentage: nothing shows that such a number would be calibrated.
//
// Kept apart: the rated mood (entries), this estimate (stored per day), and episode starts the
// person documents (with their source). The app's earlier colours are never used as truth.

import type { DateKey, MeasuredDay } from '../domain/types';
import { addDays, daysBetween, formatDateSv } from './dates';
import { RULES, RULES_VERSION } from './rules';

const R = RULES.rhythm;

// ---- data ----

/** Heart rate of one calendar day reduced on the phone: active minutes per local hour. */
export interface ActivityDay {
  date: DateKey;
  /** 24 values, local hours 00–23: minutes with a pulse well above resting. Null: no readings. */
  activeMinutes: (number | null)[];
  /** 24 values: share of the hour with a reading, 0–1. */
  worn: number[];
  restingHr: number | null;
  tzOffsetMin: number | null;
  /** "HH:MM" of the last reading. */
  lastReading: string | null;
  fetchedAt: string;
}

export type EpisodeType = 'up' | 'down' | 'mixed';
/** Where the date comes from: the person afterwards, or a clinical assessment. */
export type EpisodeSource = 'self_retro' | 'clinical';

/** An episode start the person documents. Never inferred by the app, never from the app's colours. */
export interface EpisodeStart {
  id: string;
  start: DateKey;
  end?: DateKey | null;
  type: EpisodeType;
  source: EpisodeSource;
  note?: string;
  createdAt: string;
}

export const EPISODE_WORD: Record<EpisodeType, string> = { up: 'uppvarvad', down: 'nedstämd', mixed: 'blandad' };
export const SOURCE_WORD: Record<EpisodeSource, string> = { self_retro: 'datum du angav i efterhand', clinical: 'datum från klinisk bedömning' };

/** off: not computed. show: computed and shown, never counted. use: may count in the day's level. */
export type RhythmMode = 'off' | 'show' | 'use';

// ---- features ----

/** One night, on an axis of minutes after 18:00 the evening before, so midnight is not a jump. */
export interface Night {
  /** The morning the person woke up. */
  date: DateKey;
  onset: number | null;
  wake: number | null;
  hours: number | null;
  tz: number | null;
  /** Why the night is not used: no sleep from the watch, sleep starting in the day, or just after a time-zone change. */
  excluded: null | 'missing' | 'day_sleep' | 'timezone';
}

/** The activity of the evening before a night: from 04:00 that day to 04:00 the next. */
export interface Evening {
  /** The night it leads into (the next morning). */
  night: DateKey;
  /** Share of the day's active minutes from 21:00 to 04:00. */
  late: number | null;
  /** Minutes with raised pulse from 21:00 to 04:00: a higher share may also be less in the day. */
  lateMinutes: number | null;
  /** Centre of the day's activity, minutes after 04:00. */
  centre: number | null;
  worn: number;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** "HH:MM" to minutes after 18:00. Falling asleep between 12:00 and 18:00 is day sleep. */
export function axis(t: string): number {
  return (toMin(t) - 18 * 60 + 24 * 60) % (24 * 60);
}
export function clockOfAxis(m: number): string {
  const v = Math.round((18 * 60 + m) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** Only the watch counts here: an own entry or a sleep estimated from the note is not passive. */
function fromWatch(d: MeasuredDay | undefined): boolean {
  return !!d && (d.source == null || d.source === 'garmin' || d.source === 'health');
}

export function nightsFrom(measured: Record<DateKey, MeasuredDay>, from: DateKey, to: DateKey): Night[] {
  const out: Night[] = [];
  let lastTz: number | null = null;
  let settleUntil: DateKey | null = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const m = measured[d];
    if (!fromWatch(m) || m!.sleepHours == null || !m!.sleepStart) {
      out.push({ date: d, onset: null, wake: null, hours: null, tz: null, excluded: 'missing' });
      continue;
    }
    const tz = m!.tzOffsetMin ?? null;
    if (tz != null && lastTz != null && tz !== lastTz) settleUntil = addDays(d, R.timezoneSettleNights - 1);
    if (tz != null) lastTz = tz;
    const onset = axis(m!.sleepStart);
    const night: Night = {
      date: d,
      onset,
      wake: m!.sleepEnd ? axis(m!.sleepEnd) : null,
      hours: m!.sleepHours,
      tz,
      excluded: onset >= 18 * 60 ? 'day_sleep' : settleUntil && d <= settleUntil ? 'timezone' : null,
    };
    out.push(night);
  }
  return out;
}

export function eveningOf(activity: Record<DateKey, ActivityDay>, night: DateKey): Evening {
  const day = activity[addDays(night, -1)];
  const next = activity[night];
  const hours: { h: number; active: number | null; worn: number }[] = [];
  for (let h = 4; h < 24; h++) hours.push({ h: h - 4, active: day?.activeMinutes[h] ?? null, worn: day?.worn[h] ?? 0 });
  for (let h = 0; h < 4; h++) hours.push({ h: h + 20, active: next?.activeMinutes[h] ?? null, worn: next?.worn[h] ?? 0 });
  const worn = hours.reduce((s, x) => s + x.worn, 0) / 24;
  const total = hours.reduce((s, x) => s + (x.active ?? 0), 0);
  // The evening has to be covered on its own (rules 1.8.0): a watch taken off at 21 must not read
  // as an evening without raised pulse.
  const evening = hours.filter((x) => x.h >= 17);
  const eveningWorn = evening.reduce((s, x) => s + x.worn, 0) / evening.length;
  if (worn < R.minActivityWornShare || eveningWorn < R.minActivityWornShare || total < 10) return { night, late: null, lateMinutes: null, centre: null, worn };
  const lateMinutes = evening.reduce((s, x) => s + (x.active ?? 0), 0);
  const late = lateMinutes / total;
  const centre = hours.reduce((s, x) => s + (x.active ?? 0) * (x.h * 60 + 30), 0) / total;
  return { night, late, lateMinutes, centre, worn };
}

// ---- robust statistics ----

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median and a robust spread (1.4826 × MAD), never below a floor so a very regular person is not flagged for minutes. */
function robust(xs: number[], floor: number): { mid: number; spread: number } {
  const mid = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - mid)));
  return { mid, spread: Math.max(1.4826 * mad, floor) };
}

const FLOOR = { onset: 30, wake: 30, hours: 0.5, late: 0.05, centre: 45 };

export interface Baseline {
  nights: number;
  from: DateKey;
  to: DateKey;
  onset: { mid: number; spread: number };
  wake: { mid: number; spread: number } | null;
  hours: { mid: number; spread: number };
  /** Usual change in falling asleep from one night to the next, minutes. */
  nightToNight: number;
  late: { mid: number; spread: number } | null;
  /** Usual minutes with raised pulse in the evening, for telling more evening from less daytime. */
  lateMinutes: number | null;
  evenings: number;
}

function inEpisode(d: DateKey, episodes: EpisodeStart[], margin = 0): boolean {
  return episodes.some((e) => d >= addDays(e.start, -margin) && d <= addDays(e.end ?? addDays(e.start, R.episodeDefaultDays - 1), margin));
}

/** The person's usual pattern for `today`: earlier nights, the latest days and known episodes left out. */
export function baselineFor(nights: Map<DateKey, Night>, evenings: Map<DateKey, Evening>, today: DateKey, episodes: EpisodeStart[]): Baseline | null {
  const from = addDays(today, -R.baselineDays);
  const to = addDays(today, -R.baselineGapDays - 1);
  const use: Night[] = [];
  const late: number[] = [];
  const lateMinutes: number[] = [];
  const deltas: number[] = [];
  let prev: Night | null = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const n = nights.get(d);
    if (!n || n.excluded || inEpisode(d, episodes)) { prev = null; continue; }
    use.push(n);
    if (prev) deltas.push(Math.abs(n.onset! - prev.onset!));
    prev = n;
    const e = evenings.get(d);
    if (e?.late != null) late.push(e.late);
    if (e?.lateMinutes != null) lateMinutes.push(e.lateMinutes);
  }
  if (use.length < R.baselineMinNights) return use.length ? { nights: use.length } as Baseline : null;
  const wakes = use.filter((n) => n.wake != null).map((n) => n.wake!);
  return {
    nights: use.length,
    from: use[0].date,
    to: use[use.length - 1].date,
    onset: robust(use.map((n) => n.onset!), FLOOR.onset),
    wake: wakes.length >= R.baselineMinNights ? robust(wakes, FLOOR.wake) : null,
    hours: robust(use.map((n) => n.hours!), FLOOR.hours),
    nightToNight: deltas.length ? median(deltas) : 0,
    late: late.length >= R.baselineMinNights ? robust(late, FLOOR.late) : null,
    lateMinutes: lateMinutes.length >= R.baselineMinNights ? median(lateMinutes) : null,
    evenings: late.length,
  };
}

// ---- detection ----

export type RhythmPattern = 'later' | 'earlier' | 'shorter' | 'longer' | 'irregular' | 'evening_activity';
/** A pattern in a few words, for lists. */
export const PATTERN_WORD: Record<RhythmPattern, string> = {
  later: 'senare insomning',
  earlier: 'tidigare insomning',
  shorter: 'kortare sömn',
  longer: 'längre sömn',
  irregular: 'oregelbundna sovtider',
  evening_activity: 'förhöjd puls senare på kvällen',
};

/** The order a change is named in: the first is the pattern compared with history. */
export const PATTERN_ORDER: RhythmPattern[] = ['later', 'earlier', 'shorter', 'longer', 'irregular', 'evening_activity'];

export interface RhythmChange {
  pattern: RhythmPattern;
  nights: DateKey[];
  /** The values that show it, already worded: "01:40", "5,1 h", "38 %". */
  values: string[];
  usual: string;
}

export type InsufficientReason = 'baseline' | 'recent' | 'timezone';

export interface Detection {
  status: 'insufficient' | 'stable' | 'change';
  insufficient?: { reason: InsufficientReason; have: number; need: number };
  changes: RhythmChange[];
  singleShort?: { night: DateKey; hours: number };
  /** The nights looked at, oldest first. */
  window: DateKey[];
  baseline: Baseline | null;
  activityUsed: boolean;
}

const h1 = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
const pct = (n: number) => `${Math.round(n * 100)} %`;
const z = (x: number, b: { mid: number; spread: number }) => (x - b.mid) / b.spread;

export interface Prepared {
  nights: Map<DateKey, Night>;
  evenings: Map<DateKey, Evening>;
}

/** Features for every night and evening between two dates, computed once for many days. */
export function prepare(measured: Record<DateKey, MeasuredDay>, activity: Record<DateKey, ActivityDay>, from: DateKey, to: DateKey): Prepared {
  const nights = new Map(nightsFrom(measured, from, to).map((n) => [n.date, n]));
  const evenings = new Map<DateKey, Evening>();
  for (let d = from; d <= to; d = addDays(d, 1)) evenings.set(d, eveningOf(activity, d));
  return { nights, evenings };
}

/**
 * What changed in the latest nights up to and including `today` (the morning the person woke).
 * `useActivity` false: sleep only.
 */
export function detect(p: Prepared, today: DateKey, episodes: EpisodeStart[], useActivity: boolean): Detection {
  const base = baselineFor(p.nights, p.evenings, today, episodes);
  const span = Array.from({ length: R.windowSpanNights }, (_, i) => addDays(today, -(R.windowSpanNights - 1 - i)));
  const spanNights = span.map((d) => p.nights.get(d)).filter((n): n is Night => !!n);
  const valid = spanNights.filter((n) => !n.excluded);
  const window = valid.slice(-R.windowNights).map((n) => n.date);
  const empty = { changes: [], window, baseline: base?.onset ? base : null, activityUsed: false };
  if (!base?.onset) return { status: 'insufficient', insufficient: { reason: 'baseline', have: base?.nights ?? 0, need: R.baselineMinNights }, ...empty };
  if (valid.length < R.windowNights) {
    const tz = spanNights.some((n) => n.excluded === 'timezone');
    return { status: 'insufficient', insufficient: { reason: tz ? 'timezone' : 'recent', have: valid.length, need: R.windowNights }, ...empty, window: span };
  }
  const last = valid.slice(-R.windowNights);
  const changes: RhythmChange[] = [];
  const zOn = last.map((n) => z(n.onset!, base.onset));
  const zH = last.map((n) => z(n.hours!, base.hours));
  const dates = last.map((n) => n.date);
  if (zOn.every((v) => v >= R.shiftZ)) changes.push({ pattern: 'later', nights: dates, values: last.map((n) => clockOfAxis(n.onset!)), usual: clockOfAxis(base.onset.mid) });
  if (zOn.every((v) => v <= -R.shiftZ)) changes.push({ pattern: 'earlier', nights: dates, values: last.map((n) => clockOfAxis(n.onset!)), usual: clockOfAxis(base.onset.mid) });
  if (zH.every((v) => v <= -R.durationZ)) changes.push({ pattern: 'shorter', nights: dates, values: last.map((n) => `${h1(n.hours!)} h`), usual: `${h1(base.hours.mid)} h` });
  if (zH.every((v) => v >= R.durationZ)) changes.push({ pattern: 'longer', nights: dates, values: last.map((n) => `${h1(n.hours!)} h`), usual: `${h1(base.hours.mid)} h` });

  // Irregular: falling asleep jumps far more from night to night than it usually does.
  const week = Array.from({ length: R.irregularNights }, (_, i) => p.nights.get(addDays(today, -(R.irregularNights - 1 - i))));
  const weekValid = week.filter((n): n is Night => !!n && !n.excluded);
  if (weekValid.length >= R.irregularMinNights && !changes.length) {
    const deltas: number[] = [];
    for (let i = 1; i < week.length; i++) {
      const a = week[i - 1], b = week[i];
      if (a && b && !a.excluded && !b.excluded) deltas.push(Math.abs(b.onset! - a.onset!));
    }
    const jump = deltas.length >= R.irregularMinNights - 1 ? median(deltas) : 0;
    if (jump >= Math.max(R.irregularFactor * base.nightToNight, R.irregularMinMinutes)) {
      changes.push({ pattern: 'irregular', nights: weekValid.map((n) => n.date), values: [minutesWord(jump)], usual: minutesWord(base.nightToNight) });
    }
  }

  // Activity later in the evening, read from the heart rate of the evenings before the nights.
  let activityUsed = false;
  if (useActivity && base.late) {
    const ev = dates.map((d) => p.evenings.get(d)).filter((e): e is Evening => e?.late != null);
    if (ev.length >= 2) {
      activityUsed = true;
      // A larger evening share counts only when the evening itself has more raised pulse than
      // usual, not when the share rises because the day had less (rules 1.8.0).
      const moreInTheEvening = (e: Evening) => base.lateMinutes == null || (e.lateMinutes ?? 0) > base.lateMinutes;
      if (ev.every((e) => z(e.late!, base.late!) >= R.activityZ && moreInTheEvening(e))) {
        changes.push({ pattern: 'evening_activity', nights: ev.map((e) => e.night), values: ev.map((e) => pct(e.late!)), usual: pct(base.late.mid) });
      }
    }
  }

  changes.sort((a, b) => PATTERN_ORDER.indexOf(a.pattern) - PATTERN_ORDER.indexOf(b.pattern));
  let singleShort: Detection['singleShort'];
  if (!changes.length) {
    const short = last.filter((n) => z(n.hours!, base.hours) <= -R.singleShortZ);
    if (short.length === 1) singleShort = { night: short[0].date, hours: short[0].hours! };
  }
  return { status: changes.length ? 'change' : 'stable', changes, ...(singleShort ? { singleShort } : {}), window: dates, baseline: base, activityUsed };
}

function minutesWord(m: number): string {
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)} h ${r % 60} min` : `${r} min`;
}

// ---- direction from the person's own history ----

export type DirectionValue = 'up' | 'down' | 'unclear';
/**
 * supported: the pattern came before one kind of period and not, or clearly less, outside them.
 * no_episodes: no periods to compare with. no_match: compared, and the pattern was not there.
 * both: before up and down periods. also_stable: as often outside periods.
 * no_stable_comparison: it came before a period, but no day outside the periods could be judged,
 * so it is unknown whether it is unusual (rules 1.8.0).
 * conflict: two of today's patterns point different ways (rules 1.8.0).
 */
export type DirectionReason = 'supported' | 'no_episodes' | 'no_match' | 'both' | 'also_stable' | 'no_stable_comparison' | 'conflict';

export interface EpisodeMatch {
  episodeId: string;
  start: DateKey;
  type: EpisodeType;
  source: EpisodeSource;
  /** Days in the run-up when the same pattern was among the changes. */
  days: DateKey[];
}

export interface Direction {
  value: DirectionValue;
  reason: DirectionReason;
  pattern: RhythmPattern;
  matches: EpisodeMatch[];
  /** Episodes known and old enough to compare with, per type. */
  compared: Record<EpisodeType, number>;
  /** Runs of the same pattern in stable periods. */
  stableRuns: { from: DateKey; to: DateKey }[];
  /** Stable days the model could judge (enough data). */
  stableDaysJudged: number;
  /** Every pattern of the change, each compared on its own (rules 1.8.0). Missing on older estimates. */
  byPattern?: { pattern: RhythmPattern; value: DirectionValue; reason: DirectionReason; type: EpisodeType | null }[];
}

/**
 * The direction of a change with several patterns (rules 1.8.0): each pattern is compared on its
 * own. One direction with support, and none the other way: that one. Support both ways: unclear,
 * as a conflict. No support at all: the first pattern's answer, so the reason says why.
 */
export function combinedDirection(all: Direction[]): Direction {
  const supported = all.filter((d) => d.reason === 'supported' && d.value !== 'unclear');
  const byPattern = all.map((d) => ({ pattern: d.pattern, value: d.value, reason: d.reason, type: d.matches[0]?.type ?? null }));
  const ways = new Set(supported.map((d) => d.value));
  if (ways.size > 1) return { ...supported[0], value: 'unclear', reason: 'conflict', byPattern };
  if (supported.length) return { ...supported[0], byPattern };
  return { ...all[0], byPattern };
}

/**
 * Whether the same pattern came before documented episodes, and how often it came in stable
 * periods. Only what was known before `today`: episodes whose run-up lies before the latest week.
 */
export function directionFor(p: Prepared, today: DateKey, pattern: RhythmPattern, episodes: EpisodeStart[], useActivity: boolean, histFrom: DateKey): Direction {
  const until = addDays(today, -(R.baselineGapDays + 1));
  const known = episodes.filter((e) => e.start <= until);
  const compared: Record<EpisodeType, number> = { up: 0, down: 0, mixed: 0 };
  const matches: EpisodeMatch[] = [];
  const cache = new Map<DateKey, Detection>();
  const det = (d: DateKey) => {
    let r = cache.get(d);
    if (!r) { r = detect(p, d, known, useActivity); cache.set(d, r); }
    return r;
  };
  for (const e of known) {
    const days: DateKey[] = [];
    let judged = 0;
    for (let i = R.preEpisodeDays; i >= 1; i--) {
      const d = addDays(e.start, -i);
      if (d < histFrom) continue;
      const r = det(d);
      if (r.status !== 'insufficient') judged++;
      if (r.status === 'change' && r.changes.some((c) => c.pattern === pattern)) days.push(d);
    }
    if (judged) compared[e.type]++;
    if (days.length) matches.push({ episodeId: e.id, start: e.start, type: e.type, source: e.source, days });
  }
  const stableRuns: { from: DateKey; to: DateKey }[] = [];
  let stableDaysJudged = 0;
  for (let d = histFrom; d <= until; d = addDays(d, 1)) {
    if (inEpisode(d, known, R.stableMarginDays)) continue;
    const r = det(d);
    if (r.status === 'insufficient') continue;
    stableDaysJudged++;
    if (r.status === 'change' && r.changes.some((c) => c.pattern === pattern)) {
      const run = stableRuns[stableRuns.length - 1];
      if (run && daysBetween(run.to, d) <= 2) run.to = d;
      else stableRuns.push({ from: d, to: d });
    }
  }
  const up = matches.filter((m) => m.type === 'up').length;
  const down = matches.filter((m) => m.type === 'down').length;
  const base = { pattern, matches, compared, stableRuns, stableDaysJudged };
  if (!known.length) return { value: 'unclear', reason: 'no_episodes', ...base };
  if (up && down) return { value: 'unclear', reason: 'both', ...base };
  const m = Math.max(up, down);
  if (!m) return { value: 'unclear', reason: 'no_match', ...base };
  // Nothing outside the periods to compare with is not the same as the pattern never being there.
  if (stableDaysJudged === 0) return { value: 'unclear', reason: 'no_stable_comparison', ...base };
  const st = stableRuns.length;
  if (st === 0 || (m >= 2 && st < m)) return { value: up ? 'up' : 'down', reason: 'supported', ...base };
  return { value: 'unclear', reason: 'also_stable', ...base };
}

// ---- the stored estimate ----

export interface RhythmAssessment {
  rulesVersion: string;
  /** The morning it is about: the latest night is the night before this date. */
  date: DateKey;
  computedAt: string;
  /** The nights looked at. */
  covers: { from: DateKey; to: DateKey };
  status: Detection['status'];
  insufficient?: Detection['insufficient'];
  changes: RhythmChange[];
  singleShort?: Detection['singleShort'];
  direction: Direction | null;
  baseline: Pick<Baseline, 'nights' | 'from' | 'to' | 'evenings'> & { onset: string; hours: string; late: string | null } | null;
  activityAvailable: boolean;
  activityUsed: boolean;
  /** First day of the run of changes this day belongs to: one course, one card. */
  courseStart: DateKey | null;
  /** Worded for the screen and the card. */
  text: { change: string; direction: string | null };
}

export interface RhythmData {
  measured: Record<DateKey, MeasuredDay>;
  activity: Record<DateKey, ActivityDay>;
  episodes: EpisodeStart[];
}

/** The estimate for one morning, with only data up to that morning. */
export function assessRhythm(data: RhythmData, today: DateKey, computedAt: string, opts: { previous?: RhythmAssessment | null; useActivity?: boolean } = {}): RhythmAssessment {
  const from = addDays(today, -(R.baselineDays + 365));
  const measuredDates = Object.keys(data.measured).filter((d) => d <= today).sort();
  const histFrom = measuredDates.find((d) => d >= from) ?? today;
  const p = prepare(data.measured, data.activity, histFrom, today);
  const activityAvailable = Object.keys(data.activity).some((d) => d >= addDays(today, -R.windowSpanNights) && d <= today);
  const useActivity = opts.useActivity ?? true;
  const r = detect(p, today, data.episodes.filter((e) => e.start <= today), useActivity);
  const direction = r.status === 'change' ? combinedDirection(r.changes.map((c) => directionFor(p, today, c.pattern, data.episodes, useActivity, histFrom))) : null;
  const prev = opts.previous;
  const courseStart = r.status !== 'change' ? null
    : prev && prev.status === 'change' && prev.courseStart && daysBetween(prev.date, today) <= 2 ? prev.courseStart : today;
  const covers = r.window.length ? { from: r.window[0], to: r.window[r.window.length - 1] } : { from: addDays(today, -(R.windowSpanNights - 1)), to: today };
  const b = r.baseline;
  const a: Omit<RhythmAssessment, 'text'> = {
    rulesVersion: RULES_VERSION,
    date: today,
    computedAt,
    covers,
    status: r.status,
    ...(r.insufficient ? { insufficient: r.insufficient } : {}),
    changes: r.changes,
    ...(r.singleShort ? { singleShort: r.singleShort } : {}),
    direction,
    baseline: b ? { nights: b.nights, from: b.from, to: b.to, evenings: b.evenings, onset: clockOfAxis(b.onset.mid), hours: `${h1(b.hours.mid)} h`, late: b.late ? pct(b.late.mid) : null } : null,
    activityAvailable,
    activityUsed: r.activityUsed,
    courseStart,
  };
  return { ...a, text: { change: changeText(a), direction: direction ? directionText(direction) : null } };
}

// ---- words ----

const NUM = ['', 'En', 'Två', 'Tre', 'Fyra', 'Fem', 'Sex', 'Sju'];
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} och ${xs[xs.length - 1]}`);

/** The nights of a change in words: "Tre nätter i rad" when they follow each other, else "Tre av de fyra senaste nätterna". */
function nightsWord(c: RhythmChange): { lead: string; gap: string } {
  const n = c.nights.length;
  const span = n ? daysBetween(c.nights[0], c.nights[n - 1]) + 1 : 0;
  if (span <= n) return { lead: `${NUM[n] ?? n} nätter i rad har du`, gap: '' };
  const missing = span - n;
  return {
    lead: `${NUM[n] ?? n} av de ${(NUM[span] ?? String(span)).toLowerCase()} senaste nätterna har du`,
    gap: ` ${missing === 1 ? 'En natt saknar' : `${NUM[missing] ?? missing} nätter saknar`} data.`,
  };
}

export function changeSentence(c: RhythmChange): string {
  const { lead, gap } = nightsWord(c);
  switch (c.pattern) {
    case 'later': return `${lead} somnat senare än vanligt: ${list(c.values)} mot vanligt ${c.usual}.${gap}`;
    case 'earlier': return `${lead} somnat tidigare än vanligt: ${list(c.values)} mot vanligt ${c.usual}.${gap}`;
    case 'shorter': return `${lead} sovit kortare än vanligt: ${list(c.values)} mot vanligt ${c.usual}.${gap}`;
    case 'longer': return `${lead} sovit längre än vanligt: ${list(c.values)} mot vanligt ${c.usual}.${gap}`;
    case 'irregular': return `Sovtiderna har varierat mer än vanligt den senaste veckan: insomningen skiftade ${c.values[0]} från natt till natt mot vanligt ${c.usual}.`;
    case 'evening_activity': return `Den förhöjda pulsen har flyttats mot kvällen: ${list(c.values)} av dygnets minuter med förhöjd puls kom efter 21 mot vanligt ${c.usual}.`;
  }
}

/** What changed, in a few words and without values: "Senare och kortare sömn". For Hem and the headings. */
export function changeHeadline(changes: RhythmChange[]): string {
  const has = (p: RhythmPattern) => changes.some((c) => c.pattern === p);
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const timing: RhythmPattern | null = has('later') ? 'later' : has('earlier') ? 'earlier' : null;
  const length: RhythmPattern | null = has('shorter') ? 'shorter' : has('longer') ? 'longer' : null;
  if (timing === 'later' && length === 'shorter') return 'Senare och kortare sömn';
  if (timing === 'earlier' && length === 'longer') return 'Tidigare och längre sömn';
  if (timing && length) return `${cap(PATTERN_WORD[timing])} och ${PATTERN_WORD[length]}`;
  if (timing) return cap(PATTERN_WORD[timing]);
  if (length) return cap(PATTERN_WORD[length]);
  if (has('irregular')) return 'Oregelbundna sovtider';
  if (has('evening_activity')) return 'Förhöjd puls senare på kvällen';
  return 'Förändring';
}

/** How much it is: "Tre nätter i rad." */
export function changeScope(changes: RhythmChange[]): string {
  const c = changes[0];
  if (!c) return '';
  if (c.pattern === 'irregular') return 'Den senaste veckan.';
  const n = c.nights.length;
  const span = n ? daysBetween(c.nights[0], c.nights[n - 1]) + 1 : 0;
  const unit = c.pattern === 'evening_activity' ? 'kvällar' : 'nätter';
  if (span > n) return `${NUM[n] ?? n} av ${(NUM[span] ?? String(span)).toLowerCase()} ${unit}. ${span - n === 1 ? 'En saknar' : `${NUM[span - n] ?? span - n} saknar`} data.`;
  return `${NUM[n] ?? n} ${unit} i rad.`;
}

/** Said against the person's own nights, never a norm for everyone: "vanliga", not "normal". */
export const STABLE_TITLE = 'Din vanliga rytm';

function changeText(a: Omit<RhythmAssessment, 'text'>): string {
  if (a.status === 'insufficient') {
    const i = a.insufficient!;
    if (i.reason === 'baseline') return `För lite data. Appen behöver minst ${i.need} nätter från klockan att jämföra med och har ${i.have}.`;
    if (i.reason === 'timezone') return `För lite data. Tidszonen har ändrats, och de första ${R.timezoneSettleNights} nätterna efter bytet jämförs inte.`;
    return `För lite data. Klockan har sömn för ${i.have} av de ${R.windowSpanNights} senaste nätterna. Har klockan inte burits, eller inte synkat?`;
  }
  if (a.status === 'stable') {
    const base = 'De senaste nätterna ligger inom din vanliga rytm: insomning och sömnlängd som du brukar ha.';
    return a.singleShort ? `${base} En natt var kort (${h1(a.singleShort.hours)} timmar), men det är en enstaka natt, inte en förändring.` : base;
  }
  const later = a.changes.find((c) => c.pattern === 'later');
  const evening = a.changes.find((c) => c.pattern === 'evening_activity');
  const parts = a.changes.filter((c) => !(later && evening && c === evening)).map(changeSentence);
  if (later && evening) parts.push('Även den förhöjda pulsen har flyttats mot kvällen.');
  return parts.join(' ');
}

const typeWord = (t: EpisodeType) => ({ up: 'uppvarvade', down: 'nedstämda', mixed: 'blandade' }[t]);
const typeWordOne = (t: EpisodeType) => ({ up: 'uppvarvad', down: 'nedstämd', mixed: 'blandad' }[t]);

/** The comparison with history in one line, when the history supports it. Null: nothing it resembles. */
export function directionHeadline(d: Direction | null): string | null {
  if (!d || d.reason !== 'supported' || d.value === 'unclear') return null;
  return `Liknar mönstret före en tidigare ${typeWordOne(d.value)} period`;
}

/**
 * The comparison with the person's earlier periods, in words. It says what the pattern resembles,
 * never that a period is starting.
 */
export function directionText(d: Direction): string {
  const m = d.matches[0];
  const judged = d.stableDaysJudged === 1 ? 'den enda dag' : `de ${d.stableDaysJudged} dagar`;
  // "Outside the periods" rather than "stable": that the mood was calm then is not known (rules 1.8.0).
  const stable = d.stableRuns.length
    ? ` Samma mönster fanns också ${d.stableRuns.length === 1 ? 'en gång' : `${d.stableRuns.length} gånger`} under ${judged} utanför registrerade perioder som gick att bedöma (${formatDateSv(d.stableRuns[0].from)}${d.stableRuns[0].to !== d.stableRuns[0].from ? `–${formatDateSv(d.stableRuns[0].to)}` : ''}).`
    : ` Mönstret fanns inte under någon av ${judged} utanför registrerade perioder som gick att bedöma.`;
  const like = m ? `Liknar mönstret före en tidigare ${typeWordOne(m.type)} period, som började ${formatDateSv(m.start)} (${SOURCE_WORD[m.source]}).` : '';
  switch (d.reason) {
    case 'supported':
      return `${like}${stable}`;
    case 'also_stable':
      return `${like}${stable} Därför går det inte att säga åt vilket håll det pekar.`;
    case 'no_stable_comparison':
      return `${like} Det finns inga dagar utanför registrerade perioder som gick att bedöma, så det går inte att säga om mönstret är ovanligt för dig.`;
    case 'conflict': {
      const parts = (d.byPattern ?? []).filter((p) => p.reason === 'supported' && p.type).map((p) => `${PATTERN_WORD[p.pattern]} före en ${typeWordOne(p.type!)} period`);
      return `Mönstren pekar åt olika håll: ${parts.join(' och ')}. Det går inte att säga åt vilket håll det pekar.`;
    }
    case 'both':
      return 'Samma mönster fanns före både uppvarvade och nedstämda perioder. Det går inte att säga åt vilket håll det pekar.';
    case 'no_episodes':
      return 'Det finns inga tidigare perioder inlagda att jämföra med.';
    case 'no_match': {
      const n = d.compared.up + d.compared.down + d.compared.mixed;
      const which = n === 1 ? 'den tidigare period' : `någon av de ${n} tidigare perioder`;
      return `Mönstret fanns inte före ${which} appen kunde jämföra med.${d.stableRuns.length ? stable : ''}`;
    }
  }
}

/** A short line for a list: "uppvarvad 3 mars (efterhand)". */
export function episodeLine(e: Pick<EpisodeStart, 'type' | 'start' | 'source'>): string {
  return `${typeWord(e.type)} ${formatDateSv(e.start)}`;
}
