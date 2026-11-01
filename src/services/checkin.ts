// Evening check-in and "Orkar bara trycka": build the entry, assess it, save both.

import { assessEntry, newId, wordMatcher } from '../analysis/assess';
import { eveningDateKey } from '../analysis/dates';
import { parseSleepHours } from '../analysis/sleep';
import type { Assessment, Entry } from '../domain/types';
import { akutLevel } from '../context/akut';
import { setRoutineDone } from '../plan/routines';
import type { Repository } from '../storage/repository';
import { refreshForCheckin, type GarminOptions } from './garmin';
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
  /** Routines ticked off this evening, by routine id; null removes an earlier answer. Never part of the assessment. */
  routines?: Record<string, boolean | null>;
}

/** One medication answer per evening; a new answer replaces the old. */
export async function setMedicationTaken(repo: Repository, date: string, taken: boolean): Promise<void> {
  for (const old of repo.contextOf('medication_taken').filter((e) => e.date === date)) await repo.removeContextEntry(old.id, false);
  await repo.addContextEntry({ kind: 'medication_taken', text: '', origin: 'user', date, taken });
}

export async function saveCheckin(
  repo: Repository,
  input: CheckinInput,
  now = new Date(),
  adapterOptions: AdapterOptions = {},
  garminOptions: GarminOptions = {},
): Promise<{ entry: Entry; assessment: Assessment }> {
  const date = eveningDateKey(now);
  // The emergency rule runs first, in code, before anything can leave the phone. On a
  // match nothing is fetched or sent: the crisis numbers must show at once, also offline.
  const level = akutLevel(input.transcript, repo.contextOf('akut').map((e) => e.text));
  const akut = level === 'full';
  // A negated match ("vill inte dö") shows a gentler card; the note still never goes to a model.
  const akutMild = level === 'mild';
  if (input.medicationTaken != null) await setMedicationTaken(repo, date, input.medicationTaken);
  for (const [id, done] of Object.entries(input.routines ?? {})) {
    const routine = repo.findEntry(id);
    if (routine?.kind === 'routine') await setRoutineDone(repo, date, routine, done);
  }
  // Fresh numbers for today's stress; on failure the stored values are used.
  if (!akut) await refreshForCheckin(repo, { ...garminOptions, now });
  const g = repo.garminDay(date);
  // Garmin first; "sov X timmar" in the note is the fallback, marked as estimated.
  const sleep = g?.sleepHours ?? parseSleepHours(input.transcript);
  const sleepSource = g?.sleepHours != null ? 'garmin' : sleep != null ? 'transcript' : null;
  const entry: Entry = {
    id: newId('e'),
    date,
    createdAt: now.toISOString(),
    kind: 'checkin',
    transcript: input.transcript.trim(),
    mood: input.mood,
    energy: input.energy,
    wordsPerMinute: input.wordsPerMinute,
    sleepHours: sleep,
    sleepSource,
    stressAvg: g?.stressAvg ?? null,
    ...(input.strainYesterday ? { strainYesterday: true } : {}),
  };
  const assessment = await assessEntry({
    entry,
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    history: repo.history(),
    // The configured language model when there is one; word matching otherwise, and
    // always word matching when the emergency rule matched.
    matcher: akut || akutMild ? wordMatcher : await currentMatcher(repo, { now: () => now, ...adapterOptions }),
    garmin: repo.garminDays(),
    context: repo.contextEntries(),
    akut,
    akutMild,
    now,
  });
  await repo.saveEntry(entry, assessment);
  return { entry, assessment };
}

export async function logHeavyDay(repo: Repository, now = new Date()): Promise<{ entry: Entry; assessment: Assessment }> {
  // No network here: the button must answer at once. Stored Garmin values are used.
  const g = repo.garminDay(eveningDateKey(now));
  const entry: Entry = {
    id: newId('e'),
    date: eveningDateKey(now),
    createdAt: now.toISOString(),
    kind: 'heavy',
    transcript: '',
    mood: null,
    energy: null,
    wordsPerMinute: null,
    sleepHours: g?.sleepHours ?? null,
    sleepSource: g?.sleepHours != null ? 'garmin' : null,
    stressAvg: g?.stressAvg ?? null,
  };
  const assessment = await assessEntry({
    entry,
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    history: repo.history(),
    matcher: wordMatcher,
    garmin: repo.garminDays(),
    context: repo.contextEntries(),
    now,
  });
  await repo.saveEntry(entry, assessment);
  return { entry, assessment };
}
