// Dygnsrytm (experimental), the phone's side: fetches the heart rate after each successful
// Garmin sync, computes the passive estimate for the morning and keeps it apart from the rated
// mood and from the episode starts the person documents. Nothing here is sent anywhere but Garmin.
//
// When does it run? After every successful sync. A sync runs when the app opens or comes to the
// front, before a check-in and when the person taps Hämta igen. The web version on an iPhone
// cannot run while closed (Safari gives web apps no background fetch), and the phone app has no
// background task either, so in practice the estimate is computed when the app is opened. The
// sync log below shows it: every sync records whether the app was in front.

import { addDays, toDateKey } from '../core/analysis/dates';
import { assessRhythm, type ActivityDay, type EpisodeStart, type RhythmAssessment, type RhythmMode } from '../core/analysis/rhythm';
import { recomputeHistory } from '../core/analysis/recompute';
import { evaluateRhythm, type RhythmEvaluation } from '../core/analysis/rhythmEval';
import type { DateKey, Level, MeasuredDay, RhythmScoreInput } from '../core/domain/types';
import { GarminClient, GarminError } from '../garmin/client';
import { garminBaseUrl } from '../platform/endpoints';
import type { Repository } from '../storage/repository';
import { firstStep } from '../core/analysis/assess';
import { sleepRoutineText } from '../core/analysis/sleepNotice';
import { getKey } from './keys';

/** Before month documents: one document with every day. Read, and moved on the next save. */
export const ACTIVITY_KEY = 'rhythmActivity';
/** Heart-rate days, one document per month ("rhythmActivity:2026-11"), so no document grows too large. */
export const ACTIVITY_MONTH_PREFIX = 'rhythmActivity:';
/** Days Garmin had no pulse for: not asked again. */
const ACTIVITY_EMPTY_KEY = 'rhythmActivityEmpty';
export const ACTIVITY_PROGRESS_KEY = 'rhythmActivityProgress';
export const ASSESSMENTS_KEY = 'rhythmAssessments';
export const EPISODES_KEY = 'episodeStarts';
export const FEEDBACK_KEY = 'rhythmFeedback';
export const SYNC_LOG_KEY = 'garminSyncLog';
export const ACTIVITY_SOURCE_KEY = 'rhythmActivitySource';
export const SEEN_KEY = 'rhythmSeen';

/** Heart-rate days fetched per sync at most: one call each. */
export const ACTIVITY_DAYS_PER_SYNC = 8;
const KEEP_ASSESSMENTS = 90;
const KEEP_SYNC_LOG = 40;

export type SyncTrigger = 'open' | 'checkin' | 'manual' | 'connect';

export interface SyncLogEntry {
  at: string;
  trigger: SyncTrigger;
  ok: boolean;
  /** The app was in front when the sync ran. Always true so far: the app cannot fetch while closed. */
  inFront: boolean;
  /** Newest night and heart-rate day the sync brought, if any. */
  newestNight: DateKey | null;
  heartRateDays: number;
}

export interface ActivitySource {
  status: 'ok' | 'not_exposed' | 'error' | 'unknown';
  checkedAt: string | null;
  message: string | null;
}

export interface RhythmFeedback {
  /** The person's own explanation, optional: travel, illness, guests, a deadline. */
  reason: string;
  at: string;
}

// ---- reading what is stored ----

export function rhythmMode(repo: Repository): RhythmMode {
  return repo.settings().rhythm ?? 'off';
}

export function activityDays(repo: Repository): Record<DateKey, ActivityDay> {
  const out: Record<DateKey, ActivityDay> = { ...((repo.kvGet(ACTIVITY_KEY) as Record<DateKey, ActivityDay> | undefined) ?? {}) };
  for (const k of repo.kvKeys(ACTIVITY_MONTH_PREFIX)) Object.assign(out, repo.kvGet(k) as Record<DateKey, ActivityDay>);
  return out;
}

/** Saves heart-rate days into their month documents; the old single document is emptied into them. */
export async function saveActivityDays(repo: Repository, days: ActivityDay[]): Promise<void> {
  const legacy = (repo.kvGet(ACTIVITY_KEY) as Record<DateKey, ActivityDay> | undefined) ?? null;
  const all = legacy ? [...Object.values(legacy), ...days] : days;
  const months = new Map<string, ActivityDay[]>();
  for (const d of all) {
    const m = d.date.slice(0, 7);
    months.set(m, [...(months.get(m) ?? []), d]);
  }
  for (const [m, list] of months) {
    const key = ACTIVITY_MONTH_PREFIX + m;
    const cur = { ...((repo.kvGet(key) as Record<DateKey, ActivityDay> | undefined) ?? {}) };
    for (const d of list) cur[d.date] = d;
    await repo.kvSet(key, cur);
  }
  if (legacy) await repo.kvRemove(ACTIVITY_KEY);
}

export function rhythmAssessments(repo: Repository): Record<DateKey, RhythmAssessment> {
  return (repo.kvGet(ASSESSMENTS_KEY) as Record<DateKey, RhythmAssessment> | undefined) ?? {};
}

/** The latest estimate, if any. */
export function latestRhythm(repo: Repository): RhythmAssessment | null {
  const all = rhythmAssessments(repo);
  const last = Object.keys(all).sort().pop();
  return last ? all[last] : null;
}

export function episodeStarts(repo: Repository): EpisodeStart[] {
  return ((repo.kvGet(EPISODES_KEY) as EpisodeStart[] | undefined) ?? []).slice().sort((a, b) => a.start.localeCompare(b.start));
}

export function rhythmFeedback(repo: Repository): Record<DateKey, RhythmFeedback> {
  return (repo.kvGet(FEEDBACK_KEY) as Record<DateKey, RhythmFeedback> | undefined) ?? {};
}

export function syncLog(repo: Repository): SyncLogEntry[] {
  return (repo.kvGet(SYNC_LOG_KEY) as SyncLogEntry[] | undefined) ?? [];
}

export function activitySource(repo: Repository): ActivitySource {
  return (repo.kvGet(ACTIVITY_SOURCE_KEY) as ActivitySource | undefined) ?? { status: 'unknown', checkedAt: null, message: null };
}

/** Only the watch: an own entry or a sleep estimated from a note is not passive data. */
export function watchNights(repo: Repository): Record<DateKey, MeasuredDay> {
  return { ...repo.healthDays(), ...repo.allGarminDays() };
}

// ---- writing ----

export async function saveEpisode(repo: Repository, e: EpisodeStart): Promise<void> {
  const list = episodeStarts(repo).filter((x) => x.id !== e.id);
  await repo.kvSet(EPISODES_KEY, [...list, e]);
}

export async function removeEpisode(repo: Repository, id: string): Promise<void> {
  await repo.kvSet(EPISODES_KEY, episodeStarts(repo).filter((x) => x.id !== id));
}

/** An optional correction: the change has another explanation. Never needed for the estimate to work. */
export async function explainCourse(repo: Repository, courseStart: DateKey, reason: string, now = new Date()): Promise<void> {
  await repo.kvSet(FEEDBACK_KEY, { ...rhythmFeedback(repo), [courseStart]: { reason: reason.trim(), at: now.toISOString() } });
}

export async function undoExplanation(repo: Repository, courseStart: DateKey): Promise<void> {
  const next = { ...rhythmFeedback(repo) };
  delete next[courseStart];
  await repo.kvSet(FEEDBACK_KEY, next);
}

export async function setRhythmMode(repo: Repository, mode: RhythmMode, now = new Date()): Promise<void> {
  await repo.updateSettings({ rhythm: mode });
  if (mode !== 'off') await updateRhythm(repo, now);
}

function inFront(): boolean {
  const doc = (globalThis as { document?: { visibilityState?: string } }).document;
  return doc?.visibilityState ? doc.visibilityState === 'visible' : true;
}

export async function recordSync(repo: Repository, entry: Omit<SyncLogEntry, 'inFront'>): Promise<void> {
  const next = [{ ...entry, inFront: inFront() }, ...syncLog(repo)].slice(0, KEEP_SYNC_LOG);
  await repo.kvSet(SYNC_LOG_KEY, next);
}

// ---- heart rate ----

/** Days whose heart rate is missing or was fetched before the day was over. Newest first. */
export function activityDaysToFetch(have: Record<DateKey, ActivityDay>, today: DateKey, max = ACTIVITY_DAYS_PER_SYNC): DateKey[] {
  const out: DateKey[] = [];
  for (let i = 0; i < 8 && out.length < max; i++) {
    const d = addDays(today, -i);
    const a = have[d];
    const complete = a && a.fetchedAt.slice(0, 10) > d;
    if (!complete) out.push(d);
  }
  return out;
}

/** After a successful sync: fetches the missing heart-rate days with the same client. Never throws. */
export async function fetchActivity(repo: Repository, client: GarminClient, today: DateKey, now: Date): Promise<number> {
  if (activitySource(repo).status === 'not_exposed') return 0;
  const have = activityDays(repo);
  const got: ActivityDay[] = [];
  let fetched = 0;
  for (const d of activityDaysToFetch(have, today)) {
    try {
      const day = await client.heartRate(d);
      if (day) {
        got.push({ ...day, fetchedAt: now.toISOString() });
        fetched++;
      }
    } catch (e) {
      const notExposed = e instanceof GarminError && e.kind === 'not_exposed';
      await repo.kvSet(ACTIVITY_SOURCE_KEY, {
        status: notExposed ? 'not_exposed' : 'error',
        checkedAt: now.toISOString(),
        message: notExposed ? 'Garmin lämnar inte ut puls över dygnet via din nyckel.' : e instanceof GarminError ? e.message : 'Pulsen gick inte att hämta.',
      } satisfies ActivitySource);
      break;
    }
  }
  if (fetched) {
    await saveActivityDays(repo, got);
    await repo.kvSet(ACTIVITY_SOURCE_KEY, { status: 'ok', checkedAt: now.toISOString(), message: null } satisfies ActivitySource);
  }
  return fetched;
}

function trimDays<T>(map: Record<DateKey, T>, keep: number): Record<DateKey, T> {
  const keys = Object.keys(map).sort();
  return Object.fromEntries(keys.slice(-keep).map((k) => [k, map[k]]));
}

export interface ActivityProgress {
  /** Days with sleep from the watch that still lack heart rate when the run started, and how many are done. */
  total: number;
  done: number;
  running: boolean;
  /** Set when every day is fetched, or Garmin had nothing more. */
  finished: boolean;
  error: string | null;
  at: string;
}

export function activityProgress(repo: Repository): ActivityProgress | null {
  return (repo.kvGet(ACTIVITY_PROGRESS_KEY) as ActivityProgress | undefined) ?? null;
}

/**
 * The days whose heart rate the model can use and does not have: every day with sleep from the
 * watch, and the day before it (the evening leading into the night). Newest first. Today and the
 * latest week are fetched by the sync itself.
 */
export function missingActivityDays(repo: Repository, today: DateKey): DateKey[] {
  const have = activityDays(repo);
  const empty = new Set((repo.kvGet(ACTIVITY_EMPTY_KEY) as DateKey[] | undefined) ?? []);
  const want = new Set<DateKey>();
  for (const night of Object.keys(watchNights(repo))) {
    for (const d of [night, addDays(night, -1)]) if (d < addDays(today, -7) && !have[d] && !empty.has(d)) want.add(d);
  }
  return [...want].sort().reverse();
}

let fetching = false;

/**
 * Fetches the heart rate of every day the model can use, by itself, whenever the app is open and
 * Dygnsrytm is on. One day per call with a pause, so the Netlify hop's limit holds; saved every
 * ten days, so a closed app or a stop from Garmin continues where it left off next time.
 */
export async function fetchAllActivity(
  repo: Repository,
  opts: { cancelled?: () => boolean; pauseMs?: number; now?: Date; client?: GarminClient } = {},
): Promise<void> {
  if (fetching || rhythmMode(repo) === 'off' || !repo.garminStatus().connected || activitySource(repo).status === 'not_exposed') return;
  const now = opts.now ?? new Date();
  const want = missingActivityDays(repo, toDateKey(now));
  const before = activityProgress(repo);
  if (!want.length) {
    if (before && !before.finished) await repo.kvSet(ACTIVITY_PROGRESS_KEY, { ...before, running: false, finished: true, error: null });
    return;
  }
  let client = opts.client;
  if (!client) {
    const key = await getKey(repo, 'dagsljus.garminkey.v1');
    if (!key) return;
    client = new GarminClient({ apiKey: key, baseUrl: garminBaseUrl() });
  }
  fetching = true;
  const doneBefore = before && !before.finished ? before.done : 0;
  let progress: ActivityProgress = { total: doneBefore + want.length, done: doneBefore, running: true, finished: false, error: null, at: now.toISOString() };
  const got: ActivityDay[] = [];
  const empty = new Set((repo.kvGet(ACTIVITY_EMPTY_KEY) as DateKey[] | undefined) ?? []);
  const save = async (extra: Partial<ActivityProgress> = {}) => {
    if (got.length) await saveActivityDays(repo, got.splice(0));
    await repo.kvSet(ACTIVITY_EMPTY_KEY, [...empty].sort().slice(-2000));
    progress = { ...progress, ...extra, at: new Date().toISOString() };
    await repo.kvSet(ACTIVITY_PROGRESS_KEY, progress);
  };
  try {
    await save();
    for (const d of want) {
      if (opts.cancelled?.()) break;
      try {
        const day = await client!.heartRate(d);
        if (day && day.activeMinutes.some((m) => m != null)) got.push({ ...day, fetchedAt: now.toISOString() });
        else empty.add(d);
      } catch (e) {
        const notExposed = e instanceof GarminError && e.kind === 'not_exposed';
        if (notExposed) await repo.kvSet(ACTIVITY_SOURCE_KEY, { status: 'not_exposed', checkedAt: now.toISOString(), message: 'Garmin lämnar inte ut puls över dygnet via din nyckel.' } satisfies ActivitySource);
        await save({ running: false, error: e instanceof GarminError && e.kind === 'rate_limit' ? 'Garmin bad om en paus. Hämtningen fortsätter nästa gång appen öppnas.' : e instanceof GarminError ? e.message : 'Pulsen gick inte att hämta. Hämtningen fortsätter nästa gång appen öppnas.' });
        return;
      }
      progress.done++;
      if (progress.done % 10 === 0) await save();
      if (opts.pauseMs !== 0) await new Promise((r) => setTimeout(r, opts.pauseMs ?? 1100));
    }
    const finished = progress.done >= progress.total;
    await save({ running: false, finished });
    if (finished) await updateRhythm(repo, new Date());
  } finally {
    fetching = false;
  }
}

// ---- the estimate ----

/**
 * Computes the estimate for this morning from what is stored, and saves it. Returns null when
 * the person has not chosen the function. Runs after every successful sync and when the choice
 * or the episode starts change.
 */
export async function updateRhythm(repo: Repository, now = new Date()): Promise<RhythmAssessment | null> {
  if (rhythmMode(repo) === 'off') return null;
  const today = toDateKey(now);
  const all = rhythmAssessments(repo);
  const prevKey = Object.keys(all).filter((d) => d < today).sort().pop();
  const a = assessRhythm(
    { measured: watchNights(repo), activity: activityDays(repo), episodes: episodeStarts(repo) },
    today,
    now.toISOString(),
    { previous: prevKey ? all[prevKey] : null },
  );
  await repo.kvSet(ASSESSMENTS_KEY, trimDays({ ...all, [today]: a }, KEEP_ASSESSMENTS));
  return a;
}

/** When the app opens without a new sync: today's estimate from what is stored, if not made yet. */
export async function ensureRhythm(repo: Repository, now = new Date()): Promise<void> {
  if (rhythmMode(repo) === 'off') return;
  if (latestRhythm(repo)?.date === toDateKey(now)) return;
  await updateRhythm(repo, now).catch(() => null);
}

/** What a check-in on `date` gets from the estimate. Null when the function is off or nothing is computed for that day. */
export function rhythmScoreInput(repo: Repository, date: DateKey): RhythmScoreInput | null {
  const mode = rhythmMode(repo);
  if (mode === 'off') return null;
  const a = rhythmAssessments(repo)[date];
  if (!a) return null;
  return scoreInputOf(a, mode === 'use', !!(a.courseStart && rhythmFeedback(repo)[a.courseStart]));
}

export function scoreInputOf(a: RhythmAssessment, use: boolean, explained: boolean): RhythmScoreInput {
  return {
    date: a.date,
    computedAt: a.computedAt,
    status: a.status,
    direction: a.direction?.value ?? null,
    patterns: a.changes.map((c) => c.pattern),
    text: a.text.change,
    use,
    ...(explained ? { explained: true } : {}),
  };
}

export interface EffectDay {
  date: DateKey;
  without: Level;
  with: Level;
  /** The signal counted that day; otherwise the day changed through the days before it (the history rule). */
  direct: boolean;
}

/**
 * The levels of the latest days with and without the signal, each day seeing the levels of the
 * days before as they come out of its own choice. Days that would differ, and why.
 */
export function rhythmEffect(repo: Repository, days = 30, now = new Date()): EffectDay[] {
  const today = toDateKey(now);
  const from = addDays(today, -days);
  const entries = repo.entries().filter((e) => e.date >= addDays(from, -14));
  const assessments = repo.assessments();
  const stored = rhythmAssessments(repo);
  const feedback = rhythmFeedback(repo);
  const ctx = {
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    garmin: repo.allGarminDays(),
    medication: medicationOf(repo),
  };
  const run = (use: boolean) => recomputeHistory(entries, assessments, {
    ...ctx,
    rhythm: (date: DateKey) => {
      const a = stored[date];
      return a ? scoreInputOf(a, use, !!(a.courseStart && feedback[a.courseStart])) : null;
    },
  }, now);
  const withOut = new Map(run(false).map((d) => [d.entryId, d]));
  const out: EffectDay[] = [];
  for (const w of run(true)) {
    const o = withOut.get(w.entryId);
    if (!o || w.date < from || o.after.level === w.after.level) continue;
    out.push({ date: w.date, without: o.after.level, with: w.after.level, direct: (w.next.rhythm?.points ?? 0) > 0 });
  }
  return out;
}

function medicationOf(repo: Repository): Record<DateKey, boolean> {
  const out: Record<DateKey, boolean> = {};
  for (const e of repo.contextEntries('dagligt')) if (e.kind === 'medication_taken' && e.date && e.taken != null) out[e.date] = e.taken;
  return out;
}

/** The evaluation on the person's own data: played back in time order, on the phone. */
export function evaluateOwnData(repo: Repository, now = new Date()): RhythmEvaluation {
  const window = repo.planSettings().sleepWindow ?? null;
  return evaluateRhythm(
    { measured: watchNights(repo), activity: activityDays(repo), episodes: episodeStarts(repo) },
    { to: toDateKey(now), sleepWindow: window },
  );
}

// ---- the card on Hem ----

export interface RhythmCard {
  kind: 'rhythm' | 'rhythmData';
  /** One card per course and per what it says: a new pattern or direction is a new card, the same course is not. */
  id: string;
  assessment: RhythmAssessment;
}

/** Today's card, if there is something new: a change, or too little data. Nothing when the person has read it. */
export function rhythmCard(repo: Repository, now = new Date()): RhythmCard | null {
  if (rhythmMode(repo) === 'off') return null;
  const a = latestRhythm(repo);
  if (!a || a.date !== toDateKey(now)) return null;
  const seen = (repo.kvGet(SEEN_KEY) as string[] | undefined) ?? [];
  let card: RhythmCard | null = null;
  if (a.status === 'change' && a.courseStart && !rhythmFeedback(repo)[a.courseStart]) {
    card = { kind: 'rhythm', id: `rhythm_${a.courseStart}_${a.changes[0].pattern}_${a.direction?.value ?? 'unclear'}`, assessment: a };
  } else if (a.status === 'insufficient') {
    // Too little data for two mornings in a row, so one gap in syncing is not a card.
    const prev = rhythmAssessments(repo)[addDays(a.date, -1)];
    if (prev?.status === 'insufficient' && prev.insufficient?.reason === a.insufficient?.reason) {
      card = { kind: 'rhythmData', id: `rhythmData_${a.insufficient?.reason}_${firstInsufficient(repo, a)}`, assessment: a };
    }
  }
  return card && !seen.includes(card.id) ? card : null;
}

function firstInsufficient(repo: Repository, a: RhythmAssessment): DateKey {
  const all = rhythmAssessments(repo);
  let d = a.date;
  while (all[addDays(d, -1)]?.status === 'insufficient' && all[addDays(d, -1)]?.insufficient?.reason === a.insufficient?.reason) d = addDays(d, -1);
  return d;
}

export async function markRhythmSeen(repo: Repository, id: string): Promise<void> {
  const seen = (repo.kvGet(SEEN_KEY) as string[] | undefined) ?? [];
  if (!seen.includes(id)) await repo.kvSet(SEEN_KEY, [...seen, id].slice(-60));
}

/** A step that already is in the person's plan: the first early step in the direction, or the sleep routine. */
export function planStepFor(repo: Repository, a: RhythmAssessment): { heading: string; text: string } | null {
  const dir = a.direction?.value;
  if (dir === 'up' || dir === 'down') {
    const step = firstStep('yellow', repo.plan(), dir);
    if (step) return { heading: `Ur din plan vid ${dir === 'up' ? 'uppvarvning' : 'nedstämdhet'}`, text: step.text };
  }
  const sleep = sleepRoutineText(repo.contextOf('routine'));
  if (sleep) return { heading: 'Din sömnrutin', text: sleep };
  const step = firstStep('yellow', repo.plan(), null);
  return step ? { heading: 'Ur din plan vid gult', text: step.text } : null;
}
