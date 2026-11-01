// Evening check-in and "Orkar bara trycka": build the entry, assess it, save both.

import { assessEntry, newId, wordMatcher } from '../analysis/assess';
import { eveningDateKey } from '../analysis/dates';
import { parseSleepHours } from '../analysis/sleep';
import type { Assessment, Entry } from '../domain/types';
import { isAkut } from '../context/akut';
import type { Repository } from '../storage/repository';
import { refreshForCheckin, type GarminOptions } from './garmin';
import { currentMatcher, type AdapterOptions } from './llm';

export interface CheckinInput {
  transcript: string;
  mood: number;
  energy: number;
  /** Only set when speech was recorded and timed. */
  wordsPerMinute: number | null;
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
  const akut = isAkut(input.transcript, repo.contextOf('akut').map((e) => e.text));
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
  };
  const assessment = await assessEntry({
    entry,
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    history: repo.history(),
    // The configured language model when there is one; word matching otherwise, and
    // always word matching when the emergency rule matched.
    matcher: akut ? wordMatcher : await currentMatcher(repo, { now: () => now, ...adapterOptions }),
    garmin: repo.garminDays(),
    context: repo.contextEntries(),
    akut,
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
