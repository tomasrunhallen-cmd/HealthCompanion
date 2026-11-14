// Fetches sleep, stress and Body Battery from the user's own Garmin account and stores
// them on the phone. Runs when the app opens and just before an evening check-in.

import { addDays, eveningDateKey, localClock, toDateKey } from '../core/analysis/dates';
import { minutesBehind, STALE_MINUTES } from '../core/analysis/remeasure';
import type { DateKey, GarminDay } from '../core/domain/types';
import { GarminClient, GarminError, type GarminFetch } from '../garmin/client';
import { garminBaseUrl } from '../platform/endpoints';
import { deleteKey, getKey, setKey } from './keys';
import type { Repository } from '../storage/repository';
import { fetchActivity, recordSync, rhythmMode, updateRhythm, type SyncTrigger } from './rhythm';

export const GARMIN_KEY_NAME = 'dagsljus.garminkey.v1';

/** Days fetched on a normal sync: today and the week before (Garmin revises recent days). */
export const SYNC_DAYS = 7;
/** Days fetched when connecting, so the first assessment already has a week behind it. */
export const FIRST_SYNC_DAYS = 14;
/** The app-open sync is skipped when the last one is this recent. */
const MIN_SYNC_INTERVAL_MS = 30 * 60 * 1000;
/** When the watch lags: the person may just have opened Garmin Connect to sync it, so ask again sooner. */
const LAGGING_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export interface GarminOptions {
  fetch?: GarminFetch;
  now?: Date;
  timeoutMs?: number;
  /** What started the sync, for the sync log. */
  trigger?: SyncTrigger;
}

// One client per key and session, so the access token is reused for up to 24 hours.
let cached: { key: string; client: GarminClient } | null = null;

function clientFor(key: string, opts: GarminOptions): GarminClient {
  const baseUrl = garminBaseUrl();
  if (opts.fetch) return new GarminClient({ apiKey: key, baseUrl, fetch: opts.fetch, timeoutMs: opts.timeoutMs });
  if (!cached || cached.key !== key) cached = { key, client: new GarminClient({ apiKey: key, baseUrl, timeoutMs: opts.timeoutMs }) };
  return cached.client;
}

export interface SyncResult {
  ok: boolean;
  days: GarminDay[];
  error: string | null;
}

async function fetchRange(client: GarminClient, today: DateKey, days: number, now: Date): Promise<GarminDay[]> {
  return client.days(addDays(today, -days), today, now.toISOString());
}

/**
 * Checks the key by fetching the last two weeks. The key is saved only when Garmin
 * accepts it, so a typo never ends up in the keychain.
 */
export async function connectGarmin(repo: Repository, apiKey: string, opts: GarminOptions = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const today = toDateKey(now);
  const key = apiKey.trim();
  try {
    const days = await fetchRange(clientFor(key, opts), today, FIRST_SYNC_DAYS, now);
    await setKey(repo, GARMIN_KEY_NAME, key);
    await repo.saveGarminDays(days, today);
    await repo.updateGarminStatus({ connected: true, lastSyncAt: now.toISOString(), lastError: null });
    return { ok: true, days, error: null };
  } catch (e) {
    return { ok: false, days: [], error: e instanceof GarminError ? e.message : 'Något gick fel mot Garmin.' };
  }
}

export async function disconnectGarmin(repo: Repository): Promise<void> {
  cached = null;
  await deleteKey(repo, GARMIN_KEY_NAME);
  await repo.updateGarminStatus({ connected: false, lastError: null });
}

/** Fetches recent days. Never throws: the result and the stored status carry the error. */
export async function syncGarmin(repo: Repository, opts: GarminOptions & { days?: number } = {}): Promise<SyncResult> {
  if (!repo.garminStatus().connected) return { ok: false, days: [], error: null };
  const key = await getKey(repo, GARMIN_KEY_NAME);
  if (!key) {
    await repo.updateGarminStatus({ lastError: 'Garmin-nyckeln saknas på den här telefonen. Anslut igen.' });
    return { ok: false, days: [], error: 'Garmin-nyckeln saknas.' };
  }
  const now = opts.now ?? new Date();
  const today = toDateKey(now);
  try {
    const days = await fetchRange(clientFor(key, opts), today, opts.days ?? SYNC_DAYS, now);
    await repo.saveGarminDays(days, today);
    await repo.updateGarminStatus({ lastSyncAt: now.toISOString(), lastError: null });
    await afterSync(repo, clientFor(key, opts), days, today, now, opts.trigger ?? 'manual');
    return { ok: true, days, error: null };
  } catch (e) {
    const error = e instanceof GarminError ? e.message : 'Något gick fel mot Garmin.';
    await repo.updateGarminStatus({ lastError: error });
    await recordSync(repo, { at: now.toISOString(), trigger: opts.trigger ?? 'manual', ok: false, newestNight: null, heartRateDays: 0 }).catch(() => {});
    return { ok: false, days: [], error };
  }
}

/**
 * Dygnsrytm after every successful sync: the heart rate of the latest days, then the
 * estimate for the morning. A failure here never fails the sync.
 */
async function afterSync(repo: Repository, client: GarminClient, days: GarminDay[], today: DateKey, now: Date, trigger: SyncTrigger): Promise<void> {
  let heartRateDays = 0;
  try {
    if (rhythmMode(repo) !== 'off') {
      heartRateDays = await fetchActivity(repo, client, today, now);
      await updateRhythm(repo, now);
    }
  } catch {
    // The estimate waits for the next sync.
  }
  const newestNight = days.filter((d) => d.sleepHours != null).map((d) => d.date).sort().pop() ?? null;
  await recordSync(repo, { at: now.toISOString(), trigger, ok: true, newestNight, heartRateDays }).catch(() => {});
}

/**
 * True when today's values from the watch are missing or lag two hours or more. The app cannot
 * make the watch sync; Garmin Connect on the phone does that.
 */
export function watchLags(repo: Repository, now = new Date()): boolean {
  const m = repo.garminDay(eveningDateKey(now));
  if (!m) return true;
  const behind = minutesBehind(m.dataUntil, localClock(now));
  return behind != null && behind >= STALE_MINUTES;
}

/**
 * When the app opens or comes back to the front: fetch missing days, unless a sync ran in the
 * last half hour, or the last five minutes while the watch lags (coming back from Garmin
 * Connect after syncing the watch fetches the new values at once).
 */
export async function syncOnOpen(repo: Repository, opts: GarminOptions = {}): Promise<SyncResult | null> {
  const s = repo.garminStatus();
  if (!s.connected) return null;
  const now = opts.now ?? new Date();
  const interval = watchLags(repo, now) ? LAGGING_SYNC_INTERVAL_MS : MIN_SYNC_INTERVAL_MS;
  if (s.lastSyncAt && now.getTime() - new Date(s.lastSyncAt).getTime() < interval && !s.lastError) return null;
  return syncGarmin(repo, { trigger: 'open', ...opts });
}

/**
 * Just before a check-in: refresh today and yesterday so the day's stress is current.
 * Short timeout; on failure the stored values are used.
 */
export async function refreshForCheckin(repo: Repository, opts: GarminOptions = {}): Promise<void> {
  if (!repo.garminStatus().connected) return;
  await syncGarmin(repo, { trigger: 'checkin', ...opts, days: 1, timeoutMs: opts.timeoutMs ?? 10_000 });
}
