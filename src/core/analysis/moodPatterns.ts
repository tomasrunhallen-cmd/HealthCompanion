// Mina mönster (experimental): looks, about once a month and on request, for recurring links
// between changes in sleep and pulse from the watch and changes in the mood the person has rated.
// It needs no new daily registration: it reads the nights, the pulse and the ratings already saved.
//
// Who does what:
//   - This code computes everything: which changes there were, how often one came before or with
//     the other, the lead in days, how much data there was, and the counterexamples.
//   - A language model may, when the person has chosen it, word a short explanation of a result
//     that is already verified here. Its answer is checked (checkExplanation): no number that is
//     not in the facts, no word for a diagnosis, a cause or a forecast. It never decides anything.
//
// Against chance findings: a small, fixed list of links is tried (CANDIDATES), a link must recur
// before at least three separate periods, clearly more often than in calm times, and the test is
// corrected for the number of links tried. A finding is saved as a hypothesis with the day it was
// found, so it can be tried on later data that were not used to find it (followUp).
//
// A rated mood is a rating. It is never called an episode here, and the periods the person has
// documented (EpisodeStart) are not used as truth in this analysis.

import type { DateKey } from '../domain/types';
import { addDays, daysBetween, formatDateSvYear } from './dates';
import { detect, prepare, type RhythmData, type RhythmPattern } from './rhythm';
import { RULES } from './rules';

export const PATTERNS_VERSION = '1.1.0';

/** Every threshold in one place. Product assumptions, set before the analysis was run on real data. */
export const PATTERN_PARAMS = {
  /** The pattern counts as "before" a mood period when it was there in the days up to this many before its start ... */
  leadDays: 7,
  /** ... and as "with" it up to this many days after the start. */
  afterDays: 2,
  /** Share of the days in that window the watch must have enough data for. */
  minJudgedShare: 0.5,
  /** Rated days in the same direction at most this far apart belong to one period. */
  moodGapDays: 3,
  /** Two such periods at most this far apart are one period. */
  moodMergeDays: 5,
  /** A period's start is known only if there is another rating at most this many days before it. */
  priorDays: 10,
  /** A link must have at least this many periods to compare with, and recur before at least this many. */
  minPeriods: 3,
  minHits: 3,
  /** The pattern must be at least this many times as common before the periods as in calm times ... */
  minLift: 2,
  /** ... and the chance of the result at most this, divided by the number of links tried. */
  alpha: 0.05,
  /** Calm days needed for the comparison. */
  minCalmDays: 30,
  /** Ratings needed after a pattern to say that the mood did not change. */
  minRatedAfter: 2,
  /** Days of a pattern at most this far apart are one run. */
  runGapDays: 2,
  minRatedDays: 30,
  minNights: 30,
  maxFindings: 2,
  /**
   * The shift test (1.1.0): the period starts are moved this many days at a time through the
   * data, at least `nullMinShiftDays` from where they were, and the link must hold at most this
   * share of the shifted copies. A check on chance that does not lean on the calm-time rate.
   */
  nullStepDays: 3,
  nullMinShiftDays: 14,
  nullAlpha: 0.05,
  /** The evaluation keeps the latest share of the data as a test part that never sets anything. */
  testShare: 0.5,
} as const;

const P = PATTERN_PARAMS;

export type MoodDirection = 'up' | 'down';

export interface PatternCandidate {
  id: string;
  pattern: RhythmPattern;
  mood: MoodDirection;
}

/** The links tried: few, and decided beforehand. Only measures that are saved (sleep and the evening's pulse). */
export const CANDIDATES: readonly PatternCandidate[] = [
  { id: 'shorter_up', pattern: 'shorter', mood: 'up' },
  { id: 'later_up', pattern: 'later', mood: 'up' },
  { id: 'evening_pulse_up', pattern: 'evening_activity', mood: 'up' },
  { id: 'longer_down', pattern: 'longer', mood: 'down' },
  { id: 'shorter_down', pattern: 'shorter', mood: 'down' },
];

export interface PatternData extends RhythmData {
  /** The person's own rating per day, −3 to +3. A day without a rating is missing, never zero. */
  ratings: Record<DateKey, number>;
}

// ---- periods of rated mood ----

export interface MoodPeriod {
  direction: MoodDirection;
  start: DateKey;
  end: DateKey;
  ratedDays: number;
  /** The strongest rating in the period, as a positive number. */
  peak: number;
  /** There is another rating shortly before the start, so the start is known. */
  startKnown: boolean;
}

/**
 * Periods when the person rated the mood higher (+1 or more) or lower (−1 or less) than balanced:
 * at least two rated days, or one day at ±2 or more. A day rated otherwise ends the period.
 */
export function moodPeriods(ratings: Record<DateKey, number>, from: DateKey, to: DateKey): MoodPeriod[] {
  const days = Object.keys(ratings).filter((d) => d >= from && d <= to && typeof ratings[d] === 'number').sort();
  const out: MoodPeriod[] = [];
  for (const direction of ['up', 'down'] as const) {
    const is = (d: DateKey) => (direction === 'up' ? ratings[d] >= 1 : ratings[d] <= -1);
    const runs: Omit<MoodPeriod, 'startKnown' | 'direction'>[] = [];
    let cur: Omit<MoodPeriod, 'startKnown' | 'direction'> | null = null;
    for (const d of days) {
      if (!is(d)) { cur = null; continue; }
      const strength = Math.abs(ratings[d]);
      if (cur && daysBetween(cur.end, d) <= P.moodGapDays) {
        cur.end = d;
        cur.ratedDays++;
        cur.peak = Math.max(cur.peak, strength);
      } else {
        cur = { start: d, end: d, ratedDays: 1, peak: strength };
        runs.push(cur);
      }
    }
    const merged: typeof runs = [];
    for (const r of runs) {
      const prev = merged[merged.length - 1];
      if (prev && daysBetween(prev.end, r.start) <= P.moodMergeDays) {
        prev.end = r.end;
        prev.ratedDays += r.ratedDays;
        prev.peak = Math.max(prev.peak, r.peak);
      } else merged.push({ ...r });
    }
    for (const r of merged) {
      if (r.ratedDays < 2 && r.peak < 2) continue;
      const startKnown = days.some((d) => d < r.start && d >= addDays(r.start, -P.priorDays) && !is(d));
      out.push({ direction, ...r, startKnown });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// ---- the watch's patterns, day by day ----

interface DayPatterns {
  /** Enough nights to judge the sleep that day. */
  judged: boolean;
  /** Enough evenings with pulse to judge it. */
  pulseJudged: boolean;
  patterns: RhythmPattern[];
}

export interface Run {
  from: DateKey;
  to: DateKey;
}

/** The same model as Dygnsrytm, played over the history: what it would have shown each morning. */
function patternDays(data: RhythmData, from: DateKey, to: DateKey): Map<DateKey, DayPatterns> {
  const p = prepare(data.measured, data.activity, addDays(from, -(RULES.rhythm.baselineDays + 1)), to);
  const out = new Map<DateKey, DayPatterns>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = detect(p, d, data.episodes.filter((e) => e.start <= d), true);
    out.set(d, { judged: r.status !== 'insufficient', pulseJudged: r.status !== 'insufficient' && r.activityUsed, patterns: r.changes.map((c) => c.pattern) });
  }
  return out;
}

function runsOf(days: Map<DateKey, DayPatterns>, pattern: RhythmPattern): Run[] {
  const runs: Run[] = [];
  for (const [d, v] of days) {
    if (!v.patterns.includes(pattern)) continue;
    const last = runs[runs.length - 1];
    if (last && daysBetween(last.to, d) <= P.runGapDays) last.to = d;
    else runs.push({ from: d, to: d });
  }
  return runs;
}

const overlaps = (r: Run, from: DateKey, to: DateKey) => r.from <= to && r.to >= from;

// ---- one link ----

export interface PeriodResult {
  start: DateKey;
  end: DateKey;
  ratedDays: number;
  /** The pattern was there before or at the start. */
  hit: boolean;
  /** When that run of the pattern began, and how many days before the period's start (0 or less: at the start or after). */
  patternFrom: DateKey | null;
  lead: number | null;
}

export interface CandidateResult {
  candidate: PatternCandidate;
  /** Periods with a known start and enough watch data around it. */
  periods: PeriodResult[];
  hits: number;
  /** Mostly before the period's start, or mostly at the same time. */
  timing: 'before' | 'with';
  leadDays: number[];
  /** When the pattern began, per hit: days before the start, the same day, or after it (1.1.0). */
  when: { before: number; same: number; after: number };
  /** Share of the shifted copies with at least as high a share of hits, and how many copies (1.1.0). */
  nullShare: number;
  nullShifts: number;
  /** Runs of the pattern with ratings after them and no change in the rated mood. */
  patternOnly: Run[];
  /** Runs of the pattern with too few ratings after them to tell. */
  patternUnrated: number;
  /** Periods the watch had too little data to judge, and periods whose start is not known. */
  periodsUnjudged: number;
  periodsStartUnknown: number;
  /** How common the pattern was in calm times, 0–1, and how many calm days that rests on. */
  calmRate: number;
  calmDays: number;
  /** The chance of at least this many hits if the pattern came as often as in calm times. */
  chance: number;
  qualifies: boolean;
}

/** P(X ≥ k) for X ~ Binomial(n, q). */
export function binomialTail(n: number, k: number, q: number): number {
  if (k <= 0) return 1;
  let p = 0;
  for (let i = k; i <= n; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    p += c * q ** i * (1 - q) ** (n - i);
  }
  return Math.min(1, p);
}

/**
 * The shift test: every period start moved by the same number of days, wrapping round the data,
 * keeps how the periods lie to one another but breaks any tie to the watch. The share of such
 * copies where the pattern came before as large a share of the periods is how often the result
 * comes by chance in these very data.
 */
function shiftTest(starts: DateKey[], hits: number, judgedWindow: (d: DateKey) => boolean, runs: Run[], from: DateKey, to: DateKey): { share: number; shifts: number } {
  const lo = addDays(from, P.leadDays);
  const len = daysBetween(lo, addDays(to, -P.afterDays)) + 1;
  if (!starts.length || len < 2 * P.nullMinShiftDays) return { share: 1, shifts: 0 };
  const observed = hits / starts.length;
  let shifts = 0, asHigh = 0;
  for (let k = P.nullMinShiftDays; k <= len - P.nullMinShiftDays; k += P.nullStepDays) {
    let n = 0, h = 0;
    for (const s of starts) {
      const d = addDays(lo, (daysBetween(lo, s) + k) % len);
      if (!judgedWindow(d)) continue;
      n++;
      if (runs.some((r) => overlaps(r, addDays(d, -P.leadDays), addDays(d, P.afterDays)))) h++;
    }
    // Only copies where every start could be judged, so each copy is tried on as many periods.
    if (n < starts.length) continue;
    shifts++;
    if (h / n >= observed) asHigh++;
  }
  return { share: shifts ? asHigh / shifts : 1, shifts };
}

function evaluate(
  candidate: PatternCandidate,
  days: Map<DateKey, DayPatterns>,
  periods: MoodPeriod[],
  ratings: Record<DateKey, number>,
  from: DateKey,
  to: DateKey,
  tested: number,
): CandidateResult {
  const pulse = candidate.pattern === 'evening_activity';
  const judged = (d: DateKey) => { const v = days.get(d); return !!v && (pulse ? v.pulseJudged : v.judged); };
  const windowLength = P.leadDays + P.afterDays + 1;
  const need = Math.ceil(windowLength * P.minJudgedShare);
  const judgedWindow = (d: DateKey) => {
    let n = 0;
    for (let i = -P.leadDays; i <= P.afterDays; i++) if (judged(addDays(d, i))) n++;
    return n >= need;
  };
  const rated = (a: DateKey, b: DateKey) => { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (typeof ratings[d] === 'number') n++; return n; };
  const runs = runsOf(days, candidate.pattern);
  const same = periods.filter((p) => p.direction === candidate.mood);

  const results: PeriodResult[] = [];
  let periodsUnjudged = 0;
  let periodsStartUnknown = 0;
  for (const p of same) {
    if (!p.startKnown) { periodsStartUnknown++; continue; }
    if (!judgedWindow(p.start)) { periodsUnjudged++; continue; }
    const run = runs.find((r) => overlaps(r, addDays(p.start, -P.leadDays), addDays(p.start, P.afterDays))) ?? null;
    results.push({ start: p.start, end: p.end, ratedDays: p.ratedDays, hit: !!run, patternFrom: run?.from ?? null, lead: run ? daysBetween(run.from, p.start) : null });
  }

  // Calm times: days with a rating nearby, away from every period in this direction (also those with an unknown start).
  const nearPeriod = (d: DateKey) => same.some((p) => d >= addDays(p.start, -(P.leadDays + P.afterDays)) && d <= addDays(p.end, P.leadDays));
  let calmDays = 0;
  let calmWith = 0;
  for (let d = addDays(from, P.leadDays); d <= addDays(to, -P.afterDays); d = addDays(d, 1)) {
    if (nearPeriod(d) || !judgedWindow(d) || !rated(addDays(d, -P.leadDays), addDays(d, P.afterDays))) continue;
    calmDays++;
    if (runs.some((r) => overlaps(r, addDays(d, -P.leadDays), addDays(d, P.afterDays)))) calmWith++;
  }
  const calmRate = calmDays ? calmWith / calmDays : 0;

  const patternOnly: Run[] = [];
  let patternUnrated = 0;
  for (const r of runs) {
    if (same.some((p) => p.start <= addDays(r.to, P.leadDays) && p.end >= addDays(r.from, -P.afterDays))) continue;
    if (r.to > addDays(to, -P.leadDays)) continue; // too recent to know what followed
    if (rated(r.from, addDays(r.to, P.leadDays)) >= P.minRatedAfter) patternOnly.push(r);
    else patternUnrated++;
  }

  const hitList = results.filter((r) => r.hit);
  const leadDays = hitList.map((r) => r.lead!).filter((l) => l >= 1).sort((a, b) => a - b);
  const n = results.length;
  const hits = hitList.length;
  const chance = calmDays >= P.minCalmDays ? binomialTail(n, hits, calmRate) : 1;
  const when = {
    before: hitList.filter((r) => r.lead! >= 1).length,
    same: hitList.filter((r) => r.lead === 0).length,
    after: hitList.filter((r) => r.lead! < 0).length,
  };
  const { share: nullShare, shifts: nullShifts } = shiftTest(results.map((r) => r.start), hits, judgedWindow, runs, from, to);
  const qualifies = n >= P.minPeriods && hits >= P.minHits && calmDays >= P.minCalmDays && hits / n >= P.minLift * calmRate &&
    chance <= P.alpha / tested && nullShifts > 0 && nullShare <= P.nullAlpha;
  return {
    candidate, periods: results, hits, timing: leadDays.length * 2 >= hits ? 'before' : 'with', leadDays, when, nullShare, nullShifts,
    patternOnly, patternUnrated, periodsUnjudged, periodsStartUnknown, calmRate, calmDays, chance, qualifies,
  };
}

// ---- the analysis ----

export type PatternStatus = 'insufficient' | 'none' | 'found';
export type InsufficientWhy = 'ratings' | 'nights' | 'periods';

export interface PatternAnalysis {
  version: string;
  computedAt: string;
  from: DateKey;
  to: DateKey;
  coverage: { days: number; nights: number; evenings: number; ratedDays: number };
  /** Periods of rated mood in the data, per direction. */
  moodPeriods: Record<MoodDirection, number>;
  status: PatternStatus;
  insufficient?: InsufficientWhy;
  /** How many links were tried. */
  tested: number;
  /** Every link tried, so nothing is hidden. */
  results: CandidateResult[];
  /** At most two, the strongest first: one per direction of mood. */
  findings: CandidateResult[];
}

/** The whole analysis, on what is saved up to and including `to`. */
export function analysePatterns(data: PatternData, to: DateKey, computedAt: string): PatternAnalysis {
  const nightDates = Object.keys(data.measured).filter((d) => d <= to).sort();
  const ratedDates = Object.keys(data.ratings).filter((d) => d <= to && typeof data.ratings[d] === 'number').sort();
  const from = nightDates[0] ?? ratedDates[0] ?? to;
  const days = patternDays(data, from, to);
  const p = prepare(data.measured, data.activity, from, to);
  const nights = [...p.nights.values()].filter((n) => !n.excluded).length;
  const evenings = [...p.evenings.values()].filter((e) => e.late != null).length;
  const ratedDays = ratedDates.filter((d) => d >= from).length;
  const periods = moodPeriods(data.ratings, from, to);
  const count = (dir: MoodDirection) => periods.filter((x) => x.direction === dir).length;
  const base = {
    version: PATTERNS_VERSION, computedAt, from, to,
    coverage: { days: daysBetween(from, to) + 1, nights, evenings, ratedDays },
    moodPeriods: { up: count('up'), down: count('down') },
    tested: CANDIDATES.length,
  };
  const why: InsufficientWhy | null = nights < P.minNights ? 'nights' : ratedDays < P.minRatedDays ? 'ratings' : Math.max(count('up'), count('down')) < P.minPeriods ? 'periods' : null;
  if (why) return { ...base, status: 'insufficient', insufficient: why, results: [], findings: [] };
  const results = CANDIDATES.map((c) => evaluate(c, days, periods, data.ratings, from, to, CANDIDATES.length));
  // The strongest link per direction of mood: sleep that gets later, shorter and a later pulse are
  // often one and the same change, and showing each as a finding of its own would count it thrice.
  const ranked = results.filter((r) => r.qualifies).sort((a, b) => a.chance - b.chance || b.hits - a.hits);
  const findings = ranked.filter((r, i) => ranked.findIndex((x) => x.candidate.mood === r.candidate.mood) === i).slice(0, P.maxFindings);
  return { ...base, status: findings.length ? 'found' : 'none', results, findings };
}

// ---- a finding as a hypothesis, tried on later data ----

export interface PatternHypothesis {
  candidateId: string;
  /** The day it was found, and the last day of data used to find it. */
  foundAt: string;
  dataThrough: DateKey;
  /** The numbers it was found with: kept as they were. */
  found: { periods: number; hits: number; patternOnly: number; timing: 'before' | 'with'; leadDays: number[] };
}

export interface FollowUp {
  /** Periods that started after the finding, and how many the pattern came before. */
  periods: number;
  hits: number;
  patternOnly: number;
}

export function hypothesisOf(r: CandidateResult, a: PatternAnalysis): PatternHypothesis {
  return { candidateId: r.candidate.id, foundAt: a.computedAt, dataThrough: a.to, found: { periods: r.periods.length, hits: r.hits, patternOnly: r.patternOnly.length, timing: r.timing, leadDays: r.leadDays } };
}

/** The same count on data after the day the link was found: nothing that was used to find it. */
export function followUp(h: PatternHypothesis, a: PatternAnalysis): FollowUp | null {
  const r = a.results.find((x) => x.candidate.id === h.candidateId);
  if (!r) return null;
  const later = r.periods.filter((p) => p.start > h.dataThrough);
  return { periods: later.length, hits: later.filter((p) => p.hit).length, patternOnly: r.patternOnly.filter((x) => x.from > h.dataThrough).length };
}

/** How the hypothesis has held on data after the day it was found, in one line. */
export function followUpLine(h: PatternHypothesis, later: FollowUp): string {
  const found = `Sparat som hypotes ${formatDateSvYear(h.foundAt.slice(0, 10))}.`;
  if (!later.periods && !later.patternOnly) return `${found} Prövas på nya data: ingen ny period sedan dess.`;
  const when = h.found.timing === 'before' ? 'före' : 'vid';
  const periods = later.periods ? ` Sedan dess: mönstret kom ${when} ${num(later.hits)} av ${num(later.periods)} ${later.periods === 1 ? 'ny period' : 'nya perioder'}.` : ' Sedan dess: ingen ny period.';
  const only = later.patternOnly ? ` Det kom ${later.patternOnly === 1 ? 'en gång' : `${num(later.patternOnly)} gånger`} utan att skattningen ändrades.` : '';
  return `${found}${periods}${only}`;
}

// ---- evaluation with a frozen test part (1.1.0) ----

export interface PatternTestResult {
  candidateId: string;
  /** Periods in the test part the link could be tried on, and how many the pattern came before. */
  periods: number;
  hits: number;
  /** Periods in the test part that could not be tried yet: start unknown or too little watch data. */
  notAssessable: number;
  /** Runs of the pattern in the test part with no change in the rated mood after. */
  patternOnly: number;
  /** Share of the judged days in the test part when the pattern was there: how often it would have shown. */
  timeShown: number;
  judgedDays: number;
}

export interface PatternEvaluation {
  from: DateKey;
  /** The first day of the test part. Nothing from it on was used to find the links. */
  testFrom: DateKey;
  to: DateKey;
  development: PatternAnalysis;
  /** Each link found in the development part, tried on the test part. */
  tested: PatternTestResult[];
}

const upTo = <T>(o: Record<DateKey, T>, to: DateKey) => Object.fromEntries(Object.entries(o).filter(([k]) => k <= to)) as Record<DateKey, T>;

/**
 * The whole chain from the watch and the ratings to a finding, run in two parts: the links are
 * found on the older part only, with the same code the app runs, and then counted on the latest
 * part, which never sets a threshold or picks a link.
 */
export function evaluatePatterns(data: PatternData, to: DateKey): PatternEvaluation {
  const dates = Object.keys(data.measured).filter((d) => d <= to).sort();
  const from = dates[0] ?? to;
  const total = daysBetween(from, to) + 1;
  const testFrom = addDays(from, Math.floor(total * (1 - P.testShare)));
  const devTo = addDays(testFrom, -1);
  const development = analysePatterns({
    ...data, measured: upTo(data.measured, devTo), activity: upTo(data.activity, devTo), ratings: upTo(data.ratings, devTo),
    episodes: data.episodes.filter((e) => e.start <= devTo),
  }, devTo, `${devTo}T12:00:00.000Z`);
  const days = patternDays(data, from, to);
  const periods = moodPeriods(data.ratings, from, to);
  const tested = development.findings.map((f): PatternTestResult => {
    const r = evaluate(f.candidate, days, periods, data.ratings, from, to, CANDIDATES.length);
    const inTest = r.periods.filter((p) => p.start >= testFrom);
    const all = periods.filter((p) => p.direction === f.candidate.mood && p.start >= testFrom).length;
    const pulse = f.candidate.pattern === 'evening_activity';
    let judgedDays = 0, shown = 0;
    for (let d = testFrom; d <= to; d = addDays(d, 1)) {
      const v = days.get(d);
      if (!v || !(pulse ? v.pulseJudged : v.judged)) continue;
      judgedDays++;
      if (v.patterns.includes(f.candidate.pattern)) shown++;
    }
    return {
      candidateId: f.candidate.id, periods: inTest.length, hits: inTest.filter((p) => p.hit).length, notAssessable: all - inTest.length,
      patternOnly: r.patternOnly.filter((x) => x.from >= testFrom).length, timeShown: judgedDays ? shown / judgedDays : 0, judgedDays,
    };
  });
  return { from, testFrom, to, development, tested };
}

/** The evaluation in words, for the report. */
export function evaluationLines(ev: PatternEvaluation): string[] {
  const out = [`Utvecklingsdel ${span(ev.from, addDays(ev.testFrom, -1))}, testdel ${span(ev.testFrom, ev.to)}. Testdelen används aldrig för att välja samband eller gränser.`];
  if (!ev.tested.length) {
    out.push(ev.development.status === 'insufficient' ? 'Utvecklingsdelen hade för lite data för att hitta något samband.' : 'Utvecklingsdelen gav inget samband att pröva.');
    return out;
  }
  for (const t of ev.tested) {
    const f = ev.development.findings.find((x) => x.candidate.id === t.candidateId)!;
    const pct = Math.round(t.timeShown * 100);
    out.push(`${findingTitle(f)}: i testdelen kom mönstret före ${t.hits} av ${t.periods} perioder som gick att pröva. ${t.notAssessable} ${t.notAssessable === 1 ? 'period gick' : 'perioder gick'} inte att bedöma än. Mönstret fanns ${pct} % av ${t.judgedDays} bedömda dagar, och ${t.patternOnly} ${t.patternOnly === 1 ? 'gång' : 'gånger'} utan att skattningen ändrades.`);
  }
  return out;
}

// ---- words ----

const NUMBER = ['noll', 'en', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv'];
const num = (n: number) => NUMBER[n] ?? String(n);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export const FEATURE_WORD: Record<RhythmPattern, string> = {
  shorter: 'kortare sömn',
  longer: 'längre sömn',
  later: 'senare insomning',
  earlier: 'tidigare insomning',
  irregular: 'oregelbundna sovtider',
  evening_activity: 'förhöjd puls senare på kvällen',
};
export const MOOD_WORD: Record<MoodDirection, string> = { up: 'högre stämningsläge', down: 'lägre stämningsläge' };
const RATED_WORD: Record<MoodDirection, string> = { up: 'högre', down: 'lägre' };

/** What a finding is about, in a few words and without direction or timing: for the short card on Hem. */
export function findingTopic(r: Pick<CandidateResult, 'candidate'>): string {
  return r.candidate.pattern === 'evening_activity' ? 'Kvällspuls och stämningsläge' : 'Sömn och stämningsläge';
}

/** "Kortare sömn före högre stämningsläge". */
export function findingTitle(r: Pick<CandidateResult, 'candidate' | 'timing'>): string {
  return `${cap(FEATURE_WORD[r.candidate.pattern])} ${r.timing === 'before' ? 'före' : 'samtidigt med'} ${MOOD_WORD[r.candidate.mood]}`;
}

/** One or two sentences with the counts, and that it did not always hold. */
export function findingSummary(r: CandidateResult): string {
  const when = r.timing === 'before' ? 'före' : 'vid';
  const what = `då du skattade ${RATED_WORD[r.candidate.mood]} stämningsläge`;
  const n = r.periods.length;
  const split = whenLine(r);
  if (r.hits < n) return `Mönstret återkom ${when} ${num(r.hits)} av ${num(n)} separata perioder ${what}, men inte varje gång.${split}`;
  const also = r.patternOnly.length ? ` Det kom också ${r.patternOnly.length === 1 ? 'en gång' : `${num(r.patternOnly.length)} gånger`} utan att skattningen ändrades.` : '';
  return `Mönstret återkom ${when} alla ${num(n)} separata perioder ${what}.${split}${also}`;
}

/** " Det började före två av dem och samma dag som en." Empty when every hit has the same timing as the title says. */
function whenLine(r: CandidateResult): string {
  const w = r.when ?? { before: r.leadDays.length, same: r.hits - r.leadDays.length, after: 0 };
  const parts = [
    w.before ? `före ${num(w.before)}` : '',
    w.same ? `samma dag som ${num(w.same)}` : '',
    w.after ? `efter starten av ${num(w.after)}` : '',
  ].filter(Boolean);
  if (parts.length < 2) return '';
  const list = parts.length === 2 ? parts.join(' och ') : `${parts.slice(0, -1).join(', ')} och ${parts[parts.length - 1]}`;
  return ` Det började ${list} av dem.`;
}

/** Other links in the same direction that also hold: named with the finding, not shown as findings of their own. */
export function relatedLine(r: CandidateResult, a: PatternAnalysis): string | null {
  const others = a.results.filter((x) => x.qualifies && x.candidate.mood === r.candidate.mood && x.candidate.id !== r.candidate.id).map((x) => FEATURE_WORD[x.candidate.pattern]);
  if (!others.length) return null;
  const list = others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} och ${others[others.length - 1]}`;
  return `Även ${list} sammanföll med dessa perioder. Det är troligen samma förändring sedd på flera sätt.`;
}

const span = (from: DateKey, to: DateKey) => (from === to ? formatDateSvYear(from) : `${formatDateSvYear(from)} – ${formatDateSvYear(to)}`);

export interface Evidence {
  periods: string[];
  counterexamples: string[];
  missing: string[];
}

/** What is under Visa underlag: the periods, the counterexamples and the missing data, each as a line. */
export function findingEvidence(r: CandidateResult, a: PatternAnalysis): Evidence {
  const feature = FEATURE_WORD[r.candidate.pattern];
  const rated = RATED_WORD[r.candidate.mood];
  const periods = r.periods.filter((p) => p.hit).map((p) => {
    const lead = p.lead! >= 1 ? `${cap(feature)} började ${p.lead === 1 ? 'ett dygn' : `${num(p.lead!)} dygn`} före.` : `${cap(feature)} började samtidigt.`;
    return `Du skattade ${rated} från ${span(p.start, p.end)} (${p.ratedDays} ${p.ratedDays === 1 ? 'skattad dag' : 'skattade dagar'}). ${lead}`;
  });
  const counterexamples = [
    ...r.periods.filter((p) => !p.hit).map((p) => `Du skattade ${rated} från ${span(p.start, p.end)}, utan ${feature} före.`),
    ...r.patternOnly.map((x) => `${cap(feature)} ${span(x.from, x.to)}, utan att skattningen ändrades efteråt.`),
  ];
  const missing: string[] = [];
  if (r.periodsUnjudged) missing.push(`${cap(num(r.periodsUnjudged))} ${r.periodsUnjudged === 1 ? 'period' : 'perioder'} gick inte att bedöma: klockan saknade nätter${r.candidate.pattern === 'evening_activity' ? ' eller puls' : ''} runt starten.`);
  if (r.periodsStartUnknown) missing.push(`${cap(num(r.periodsStartUnknown))} ${r.periodsStartUnknown === 1 ? 'period' : 'perioder'} räknas inte: det saknas skattningar strax före, så starten är okänd.`);
  if (r.patternUnrated) missing.push(`${cap(num(r.patternUnrated))} ${r.patternUnrated === 1 ? 'gång' : 'gånger'} fanns mönstret men skattningar saknades efteråt.`);
  missing.push(coverageLine(a));
  return { periods, counterexamples, missing };
}

export function coverageLine(a: PatternAnalysis): string {
  const c = a.coverage;
  return `Underlaget är ${c.days} dagar, ${formatDateSvYear(a.from)} – ${formatDateSvYear(a.to)}: ${c.nights} nätter från klockan, ${c.evenings} kvällar med puls och ${c.ratedDays} skattade dagar.`;
}

/** The one line shown when there is no finding. */
export function statusLine(a: PatternAnalysis): string {
  if (a.status === 'insufficient') return 'För lite data för att hitta återkommande mönster.';
  if (a.status === 'none') return 'Inget tydligt samband hittades.';
  return a.findings.length === 1 ? 'Ett återkommande mönster hittades.' : `${cap(num(a.findings.length))} återkommande mönster hittades.`;
}

/** Why the data are too few, in one sentence. */
export function insufficientLine(a: PatternAnalysis): string | null {
  switch (a.insufficient) {
    case 'nights': return `Det behövs minst ${P.minNights} nätter från klockan, och det finns ${a.coverage.nights}.`;
    case 'ratings': return `Det behövs minst ${P.minRatedDays} skattade dagar, och det finns ${a.coverage.ratedDays}.`;
    case 'periods': return `Det behövs minst ${num(P.minPeriods)} perioder med högre eller lägre skattning att jämföra med. Det finns ${num(a.moodPeriods.up)} med högre och ${num(a.moodPeriods.down)} med lägre.`;
    default: return null;
  }
}

/** How the analysis guards against chance, for the page. */
export function methodText(a: Pick<PatternAnalysis, 'tested'>): string {
  return `Appen prövade ${num(a.tested)} samband som bestämts i förväg. Ett visas bara om mönstret kom före minst ${num(P.minHits)} separata perioder och tydligt oftare än under lugna tider, och oftare än när perioderna flyttas i tiden. Det är ett samband i dina data, inte en orsak och ingen förutsägelse. Skattningarna är dina egna skattningar, inte bekräftade episoder.`;
}

// ---- the language model: wording only ----

/** The verified numbers of one finding, as the only thing a model gets. No dates, no text the person wrote. */
export function findingFacts(r: CandidateResult, a: PatternAnalysis): string {
  const misses = r.periods.length - r.hits;
  return [
    `Mönster i klockans data: ${FEATURE_WORD[r.candidate.pattern]} än personens vanliga, flera nätter i rad.`,
    `Jämfört med: perioder då personen själv skattade ${MOOD_WORD[r.candidate.mood]}.`,
    `Perioder som gick att bedöma: ${r.periods.length}.`,
    `Perioder där mönstret fanns ${r.timing === 'before' ? 'före starten' : 'vid starten'}: ${r.hits}.`,
    r.leadDays.length ? `Dygn före starten som mönstret började: ${r.leadDays.join(', ')}.` : 'Mönstret började samtidigt som perioderna.',
    `Perioder utan mönstret: ${misses}.`,
    `Gånger mönstret fanns utan att skattningen ändrades: ${r.patternOnly.length}.`,
    `Gånger mönstret fanns men skattningar saknades efteråt: ${r.patternUnrated}.`,
    `Underlag: ${a.coverage.days} dagar, ${a.coverage.nights} nätter från klockan, ${a.coverage.ratedDays} skattade dagar.`,
  ].join('\n');
}

const NUMBER_WORDS: Record<string, number> = { två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, elva: 11, tolv: 12 };
/** Words a wording of a statistical link must not use: diagnoses, causes, forecasts, advice. */
const FORBIDDEN = /\b(?:episod|mani|hypomani|depress|deprimera|skov|diagnos|bipolär|orsak|beror på|leder till|förutsäg|förutse|varna|varning|risk|medicin)|\b(?:bör|måste|borde)(?![a-zåäö])/i;
export const EXPLANATION_MAX = 400;

/**
 * The model's explanation, checked: short, no number that is not among the facts (digits or
 * number words), and none of the words above. Null when it does not hold; then nothing is shown.
 */
export function checkExplanation(answer: unknown, facts: string): string | null {
  const raw = (answer as { text?: unknown } | null)?.text;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text || text.length > EXPLANATION_MAX || FORBIDDEN.test(text)) return null;
  const allowed = new Set((facts.match(/\d+/g) ?? []).map(Number));
  for (const d of text.match(/\d+/g) ?? []) if (!allowed.has(Number(d))) return null;
  for (const w of text.toLowerCase().match(/[a-zåäö]+/g) ?? []) if (w in NUMBER_WORDS && !allowed.has(NUMBER_WORDS[w])) return null;
  return text;
}
