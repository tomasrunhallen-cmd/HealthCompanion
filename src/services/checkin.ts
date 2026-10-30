// Evening check-in and "Orkar bara trycka": build the entry, assess it, save both.

import { assessEntry, newId, wordMatcher, type SignMatcher } from '../analysis/assess';
import { eveningDateKey } from '../analysis/dates';
import { parseSleepHours } from '../analysis/sleep';
import type { Assessment, Entry } from '../domain/types';
import type { Repository } from '../storage/repository';

export interface CheckinInput {
  transcript: string;
  mood: number;
  energy: number;
  /** Only set when speech was recorded and timed. */
  wordsPerMinute: number | null;
}

/** Step 1 always uses word matching. Step 2 swaps in the configured language model. */
export function currentMatcher(_repo: Repository): SignMatcher {
  return wordMatcher;
}

export async function saveCheckin(
  repo: Repository,
  input: CheckinInput,
  now = new Date(),
): Promise<{ entry: Entry; assessment: Assessment }> {
  const date = eveningDateKey(now);
  const sleep = parseSleepHours(input.transcript);
  const entry: Entry = {
    id: newId('e'),
    date,
    createdAt: now.toISOString(),
    kind: 'checkin',
    transcript: input.transcript.trim(),
    mood: input.mood,
    energy: input.energy,
    wordsPerMinute: input.wordsPerMinute,
    // Garmin fills this from step 3; until then the note is the fallback, marked as estimated.
    sleepHours: sleep,
    sleepSource: sleep == null ? null : 'transcript',
    stressAvg: null,
  };
  const assessment = await assessEntry({
    entry,
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    history: repo.history(),
    matcher: currentMatcher(repo),
    now,
  });
  await repo.saveEntry(entry, assessment);
  return { entry, assessment };
}

export async function logHeavyDay(repo: Repository, now = new Date()): Promise<{ entry: Entry; assessment: Assessment }> {
  const entry: Entry = {
    id: newId('e'),
    date: eveningDateKey(now),
    createdAt: now.toISOString(),
    kind: 'heavy',
    transcript: '',
    mood: null,
    energy: null,
    wordsPerMinute: null,
    sleepHours: null,
    sleepSource: null,
    stressAvg: null,
  };
  const assessment = await assessEntry({
    entry,
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    history: repo.history(),
    matcher: wordMatcher,
    now,
  });
  await repo.saveEntry(entry, assessment);
  return { entry, assessment };
}
