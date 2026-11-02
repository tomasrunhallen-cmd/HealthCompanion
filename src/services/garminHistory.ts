// Fetches Garmin's sleep and stress for a past period, for an import from another diary.
// Newest first, 28 days per round (Garmin's limit for stress), with a short pause between
// rounds. Progress is saved after every round, so a stop (too many calls, no network,
// the app closed) continues where it left off. Stops by itself when Garmin has had nothing
// for three rounds in a row: the watch was not in use that far back.

import { addDays, toDateKey } from '../core/analysis/dates';
import type { DateKey } from '../core/domain/types';
import { GarminClient, GarminError, type GarminFetch } from '../garmin/client';
import { garminBaseUrl } from '../platform/endpoints';
import { getKey } from './keys';
import type { Repository } from '../storage/repository';
import { GARMIN_KEY_NAME } from './garmin';

export const ROUND_DAYS = 28;
export const EMPTY_ROUNDS_TO_STOP = 3;
const STATE_KEY = 'garminBackfill';

export interface BackfillState {
  from: DateKey;
  to: DateKey;
  /** The newest date not yet fetched. Null when finished. */
  nextEnd: DateKey | null;
  emptyRounds: number;
  fetchedDays: number;
  /** Set when Garmin had nothing older: no need to ask again. */
  oldestWithData: DateKey | null;
}

export interface BackfillProgress {
  state: BackfillState;
  /** Days left to ask about, roughly. */
  remainingDays: number;
}

export interface BackfillResult {
  state: BackfillState;
  done: boolean;
  error: string | null;
}

export function backfillState(repo: Repository): BackfillState | null {
  return (repo.kvGet(STATE_KEY) as BackfillState | undefined) ?? null;
}

/** Starts a new period, or widens a saved one; days already fetched are not asked for again. */
export function planBackfill(saved: BackfillState | null, from: DateKey, to: DateKey): BackfillState {
  if (saved && saved.from <= from && saved.to >= to) return saved;
  return { from, to, nextEnd: to, emptyRounds: 0, fetchedDays: saved?.fetchedDays ?? 0, oldestWithData: null };
}

export async function backfillGarmin(
  repo: Repository,
  from: DateKey,
  to: DateKey,
  opts: {
    fetch?: GarminFetch;
    onProgress?: (p: BackfillProgress) => void;
    pauseMs?: number;
    /** Checked between rounds; true stops after the current round. */
    cancelled?: () => boolean;
    now?: Date;
  } = {},
): Promise<BackfillResult> {
  const key = await getKey(repo, GARMIN_KEY_NAME);
  let state = planBackfill(backfillState(repo), from, to);
  if (!key) return { state, done: false, error: 'Garmin är inte anslutet på den här enheten.' };
  const client = new GarminClient({ apiKey: key, baseUrl: garminBaseUrl(), fetch: opts.fetch });
  const fetchedAt = (opts.now ?? new Date()).toISOString();
  const pause = opts.pauseMs ?? 800;
  const save = async () => repo.kvSet(STATE_KEY, state);
  // Never ask for days after today.
  const today = toDateKey(opts.now ?? new Date());

  while (state.nextEnd && state.nextEnd >= state.from) {
    if (opts.cancelled?.()) return { state, done: false, error: null };
    const end = state.nextEnd > today ? today : state.nextEnd;
    const start = addDays(end, -(ROUND_DAYS - 1)) < state.from ? state.from : addDays(end, -(ROUND_DAYS - 1));
    let days;
    try {
      days = await client.days(start, end, fetchedAt);
    } catch (e) {
      await save();
      const message = e instanceof GarminError
        ? e.kind === 'rate_limit'
          ? 'Garmin säger att det blivit för många anrop. Hämtningen fortsätter där den slutade nästa gång.'
          : e.message
        : 'Något gick fel mot Garmin. Hämtningen fortsätter där den slutade nästa gång.';
      return { state, done: false, error: message };
    }
    const withData = days.filter((d) => d.sleepHours != null || d.stressAvg != null);
    await repo.saveGarminArchive(withData);
    state = {
      ...state,
      nextEnd: start > state.from ? addDays(start, -1) : null,
      emptyRounds: withData.length ? 0 : state.emptyRounds + 1,
      fetchedDays: state.fetchedDays + withData.length,
      oldestWithData: withData.length ? withData.map((d) => d.date).sort()[0] : state.oldestWithData,
    };
    if (state.emptyRounds >= EMPTY_ROUNDS_TO_STOP) state = { ...state, nextEnd: null };
    await save();
    opts.onProgress?.({ state, remainingDays: state.nextEnd ? Math.max(0, daysBetweenInclusive(state.from, state.nextEnd)) : 0 });
    if (state.nextEnd && pause > 0) await new Promise((r) => setTimeout(r, pause));
  }
  return { state, done: true, error: null };
}

function daysBetweenInclusive(a: DateKey, b: DateKey): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}
