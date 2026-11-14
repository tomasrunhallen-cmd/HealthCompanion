// Evening check-in and "Orkar bara trycka": build the entry, assess it, save both.

import { assessEntry, newId, wordMatcher } from '../core/analysis/assess';
import { eveningDateKey, localClock } from '../core/analysis/dates';
import { parseSleepHours } from '../core/analysis/sleep';
import type { Assessment, Entry } from '../core/domain/types';
import { akutCheck } from '../core/context/akut';
import { setRoutineDone } from './routines';
import { sleepSourceOf, stressSourceOf } from '../core/analysis/sources';
import type { Repository } from '../storage/repository';
import { refreshForCheckin, type GarminOptions } from './garmin';
import { rhythmScoreInput } from './rhythm';
import { createTextComparer } from './references';
import { currentMatcher, type AdapterOptions } from './llm';

export interface CheckinInput {
  transcript: string;
  mood: number;
  energy: number;
  /** Only set when speech was recorded and timed. */
  wordsPerMinute: number | null;
  /** Asked only when the user has medication in grund. Null: not answered. */
  medicationTaken?: boolean | null;
  /** "Alkohol, sjuk eller hård träning i går?" One tap; yes puts sleep, late sleep and stress at 0. */
  strainYesterday?: boolean;
  /** The person's own sleep and stress (B5), used when entered. They go before Garmin and the phone's health app. */
  manualSleepHours?: number | null;
  manualStress?: number | null;
  /** Routines ticked off this evening, by routine id; null removes an earlier answer. Never part of the assessment. */
  routines?: Record<string, boolean | null>;
  /** Seconds from the first touch in the check-in to saving, to see what a check-in costs. */
  durationSec?: number | null;
}

/** One medication answer per evening; a new answer replaces the old. */
export async function setMedicationTaken(repo: Repository, date: string, taken: boolean): Promise<void> {
  for (const old of repo.contextOf('medication_taken').filter((e) => e.date === date)) await repo.removeContextEntry(old.id, false);
  await repo.addContextEntry({ kind: 'medication_taken', text: '', origin: 'user', date, taken });
}

/** B7: the assessment is shown within this many milliseconds, also on a four-year-old phone. */
export const ASSESSMENT_BUDGET_MS = 10_000;
/** Fresh Garmin numbers may take at most this long; on timeout the stored values are used. */
export const GARMIN_BUDGET_MS = 3_000;
/** Kept for the word matching, saving and showing the result after the model's deadline. */
const MARGIN_MS = 1_000;

export interface CheckinResult {
  entry: Entry;
  assessment: Assessment;
  /**
   * Set when the model had not answered within the budget: the assessment shown is word
   * matching's, saved with awaitingModel. Resolves to the model's assessment once it is saved
   * in its place (same id), or null if the day was replaced in the meantime.
   */
  later?: Promise<Assessment | null>;
}

export interface BudgetOptions {
  budgetMs?: number;
  garminBudgetMs?: number;
  /** Milliseconds since some start; Date.now by default. Tests pass their own. */
  clock?: () => number;
}

function timeout(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => setTimeout(() => resolve('timeout'), Math.max(0, ms)));
}

export async function saveCheckin(
  repo: Repository,
  input: CheckinInput,
  now = new Date(),
  adapterOptions: AdapterOptions = {},
  garminOptions: GarminOptions = {},
  budget: BudgetOptions = {},
): Promise<CheckinResult> {
  const clock = budget.clock ?? Date.now;
  const started = clock();
  const budgetMs = budget.budgetMs ?? ASSESSMENT_BUDGET_MS;
  const date = eveningDateKey(now);
  // The emergency rule runs first, in code, before anything can leave the phone. On a
  // match nothing is fetched or sent: the crisis numbers must show at once, also offline.
  const check = akutCheck(input.transcript, repo.contextOf('akut').map((e) => e.text));
  const level = check.level;
  const akut = level === 'full';
  // A negated match ("vill inte dö"), or one about the past or someone else, shows a gentler
  // card; the note still never goes to a model.
  const akutMild = level === 'mild';
  if (input.medicationTaken != null) await setMedicationTaken(repo, date, input.medicationTaken);
  for (const [id, done] of Object.entries(input.routines ?? {})) {
    const routine = repo.findEntry(id);
    if (routine?.kind === 'routine') await setRoutineDone(repo, date, routine, done, false);
  }
  // Fresh numbers for today's stress; on failure the stored values are used.
  if (!akut) await refreshForCheckin(repo, { ...garminOptions, now, timeoutMs: garminOptions.timeoutMs ?? budget.garminBudgetMs ?? GARMIN_BUDGET_MS });
  if (input.manualSleepHours != null || input.manualStress != null) {
    const prev = repo.manualDays()[date];
    await repo.saveManualDay({
      date, deepMinutes: null, remMinutes: null, sleepStart: null, sleepEnd: null, stressHighMinutes: null, bodyBatteryWake: null,
      sleepHours: input.manualSleepHours ?? prev?.sleepHours ?? null,
      stressAvg: input.manualStress ?? prev?.stressAvg ?? null,
    }, now);
  }
  const g = repo.measuredDay(date);
  // The sources in order (own entry, Garmin, health app); "sov X timmar" in the note is the fallback, marked as estimated.
  const sleep = g?.sleepHours ?? parseSleepHours(input.transcript);
  const sleepSource = sleepSourceOf(g) ?? (sleep != null ? 'transcript' : null);
  const entry: Entry = {
    id: newId('e'),
    date,
    createdAt: now.toISOString(),
    localTime: localClock(now),
    kind: 'checkin',
    transcript: input.transcript.trim(),
    mood: input.mood,
    energy: input.energy,
    wordsPerMinute: input.wordsPerMinute,
    sleepHours: sleep,
    sleepSource,
    stressAvg: g?.stressAvg ?? null,
    stressSource: stressSourceOf(g),
    ...(input.strainYesterday ? { strainYesterday: true } : {}),
    // How far the watch had synced, so a day saved while it lagged can be updated later.
    ...(g?.dataUntil ? { measuredUntil: g.dataUntil } : {}),
    ...(input.durationSec != null ? { durationSec: input.durationSec } : {}),
  };
  const base = {
    entry,
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    history: repo.history(),
    garmin: repo.measuredDays(),
    context: repo.contextEntries(),
    akut,
    akutMild,
    akutMildBecause: check.mildBecause,
    // Dygnsrytm (experimental): computed after the sync above, for this day.
    rhythm: rhythmScoreInput(repo, entry.date),
    now,
  };
  // The configured language model when there is one; word matching otherwise, and always
  // word matching when the emergency rule matched.
  const matcher = akut || akutMild ? wordMatcher : await currentMatcher(repo, { now: () => now, ...adapterOptions });
  // Mina tidigare texter: only with a model, and never for a note that matched the emergency rule.
  const textComparer = matcher !== wordMatcher ? await createTextComparer(repo, input.transcript, { now: () => now, ...adapterOptions }) : null;
  if (matcher === wordMatcher) {
    const assessment = await assessEntry({ ...base, matcher });
    await repo.saveEntry(entry, assessment);
    return { entry, assessment };
  }

  // B7: the model gets the time that is left of the budget. If it has not answered by then,
  // word matching's result is saved and shown at once, and the model's fills it in later.
  const fromModel = assessEntry({ ...base, matcher, ...(textComparer ? { textComparer } : {}) });
  const left = budgetMs - (clock() - started) - MARGIN_MS;
  const first = await Promise.race([fromModel, timeout(left)]);
  if (first !== 'timeout') {
    await repo.saveEntry(entry, first);
    return { entry, assessment: first };
  }
  const quick = { ...(await assessEntry({ ...base, matcher: wordMatcher })), awaitingModel: true };
  await repo.saveEntry(entry, quick);
  const later = fromModel.then(async (a) => {
    // A new check-in the same evening replaced this one: keep that one.
    if (!repo.assessmentFor(entry.id)) return null;
    const filled: Assessment = { ...a, id: quick.id, createdAt: quick.createdAt };
    await repo.saveAssessments([filled]);
    return filled;
  }).catch(() => null);
  return { entry, assessment: quick, later };
}

export async function logHeavyDay(repo: Repository, now = new Date()): Promise<{ entry: Entry; assessment: Assessment }> {
  // No network here: the button must answer at once. Stored Garmin values are used.
  const g = repo.measuredDay(eveningDateKey(now));
  const entry: Entry = {
    id: newId('e'),
    date: eveningDateKey(now),
    createdAt: now.toISOString(),
    localTime: localClock(now),
    kind: 'heavy',
    transcript: '',
    mood: null,
    energy: null,
    wordsPerMinute: null,
    sleepHours: g?.sleepHours ?? null,
    sleepSource: sleepSourceOf(g),
    stressAvg: g?.stressAvg ?? null,
    stressSource: stressSourceOf(g),
    ...(g?.dataUntil ? { measuredUntil: g.dataUntil } : {}),
  };
  const assessment = await assessEntry({
    entry,
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    history: repo.history(),
    matcher: wordMatcher,
    garmin: repo.measuredDays(),
    context: repo.contextEntries(),
    rhythm: rhythmScoreInput(repo, entry.date),
    now,
  });
  await repo.saveEntry(entry, assessment);
  return { entry, assessment };
}
