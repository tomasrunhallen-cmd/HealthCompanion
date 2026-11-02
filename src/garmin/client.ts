// Garmin Connect Personal API, called directly from the phone with the user's own key.
// Pull only: the app asks for the days it is missing. No server is involved.
//
// Verified 2026-10-30 (see README for sources):
// - Token: POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token
//   with header "Authorization: ApiKey <key>". The body of the answer is the access
//   token as plain text (a JWT with an exp claim), valid at most 24 hours, no refresh token.
//   (Garmin developer pages and Garmin's own Python client, garmin-connect-personal-api-python 1.0.0.)
// - Data: GET with "Authorization: Bearer <token>".
//   Sleep:  /sleep-service/sleep/dailySleepSummariesByDate?startDate=&endDate=   (≤31 days)
//   Stress: /usersummary-service/stats/stress/daily/{start}/{end}               (≤28 days)
//   Body Battery: /wellness-service/wellness/bodyBattery/reports/daily?startDate=&endDate=
//   (paths from Garmin's Python client; range limits from third-party clients).
// - Field names are not in Garmin's public pages; they come from two independent
//   open-source clients of the same API and are parsed defensively.

import type { DateKey, GarminDay } from '../core/domain/types';

export const GARMIN_BASE_URL = 'https://personal.connectapi.garmin.com';
export const GARMIN_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
export const GARMIN_KEY_PAGE = 'https://connect.garmin.com/app/settings/personalApiToken';

export type GarminFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type GarminErrorKind = 'auth' | 'not_exposed' | 'rate_limit' | 'server' | 'network' | 'timeout' | 'bad_answer';

export class GarminError extends Error {
  constructor(readonly kind: GarminErrorKind, message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'GarminError';
  }
}

// ---- small pure helpers ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64url to text without relying on atob (not on every JS engine). */
function base64UrlDecode(s: string): string {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B64.indexOf(ch);
    if (idx < 0) throw new Error('bad base64');
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
}

/** Expiry of a JWT in milliseconds since the epoch, without checking the signature. */
export function jwtExpiryMs(token: string): number {
  try {
    const payload = JSON.parse(base64UrlDecode(token.split('.')[1] ?? ''));
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp)) throw new Error('no exp');
    return exp * 1000;
  } catch {
    throw new GarminError('bad_answer', 'Garmin svarade med en nyckel som inte gick att läsa.');
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Garmin's "...Local" epoch values are wall-clock time encoded as UTC. */
export function localClock(ms: unknown): string | null {
  const v = num(ms);
  if (v == null) return null;
  const d = new Date(v);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function rows(data: unknown, key?: string): any[] {
  if (Array.isArray(data)) return data;
  if (key && data && typeof data === 'object' && Array.isArray((data as any)[key])) return (data as any)[key];
  return [];
}

// ---- parsing ----

export interface SleepRow {
  date: DateKey;
  sleepHours: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  /** GMT epoch ms of waking, used to find Body Battery after waking. */
  wakeGmtMs: number | null;
}

export function parseSleep(data: unknown): SleepRow[] {
  return rows(data)
    .map((r) => r?.dailySleepDTO ?? r)
    .filter((r) => typeof r?.calendarDate === 'string' && num(r.sleepTimeSeconds) != null && r.sleepTimeSeconds > 0)
    .map((r) => ({
      date: r.calendarDate,
      sleepHours: round1(r.sleepTimeSeconds / 3600),
      deepMinutes: num(r.deepSleepSeconds) != null ? Math.round(r.deepSleepSeconds / 60) : null,
      remMinutes: num(r.remSleepSeconds) != null ? Math.round(r.remSleepSeconds / 60) : null,
      sleepStart: localClock(r.sleepStartTimestampLocal),
      sleepEnd: localClock(r.sleepEndTimestampLocal),
      wakeGmtMs: num(r.sleepEndTimestampGMT),
    }));
}

export interface StressRow {
  date: DateKey;
  stressAvg: number | null;
  stressHighMinutes: number | null;
}

export function parseStress(data: unknown): StressRow[] {
  return rows(data)
    .filter((r) => typeof r?.calendarDate === 'string')
    .map((r) => {
      const v = r.values ?? r;
      const level = num(v?.overallStressLevel);
      const high = num(v?.highStressDuration);
      return {
        date: r.calendarDate,
        // Garmin uses negative values when there is too little data for the day.
        stressAvg: level != null && level >= 0 ? level : null,
        stressHighMinutes: high != null && high >= 0 ? Math.round(high / 60) : null,
      };
    });
}

export interface BodyBatteryRow {
  date: DateKey;
  /** [GMT epoch ms, level] pairs. */
  values: [number, number][];
}

export function parseBodyBattery(data: unknown): BodyBatteryRow[] {
  return rows(data)
    .filter((r) => typeof r?.date === 'string')
    .map((r) => ({
      date: r.date,
      values: rows(r.bodyBatteryValuesArray).filter(
        (v): v is [number, number] => Array.isArray(v) && num(v[0]) != null && num(v[1]) != null,
      ),
    }));
}

/** Combines the three sources into one record per calendar date. */
export function mergeDays(
  sleep: SleepRow[],
  stress: StressRow[],
  bodyBattery: BodyBatteryRow[],
  fetchedAt: string,
): GarminDay[] {
  const dates = new Set<DateKey>([...sleep.map((s) => s.date), ...stress.map((s) => s.date)]);
  return Array.from(dates).sort().map((date) => {
    const sl = sleep.find((s) => s.date === date);
    const st = stress.find((s) => s.date === date);
    const bb = bodyBattery.find((b) => b.date === date);
    let bodyBatteryWake: number | null = null;
    if (bb && sl?.wakeGmtMs != null) {
      const after = bb.values.find((v) => v[0] >= sl.wakeGmtMs!);
      bodyBatteryWake = after ? after[1] : null;
    }
    // The last reading of the day: how far the watch had synced to Garmin.
    const last = bb?.values.length ? Math.max(...bb.values.map((v) => v[0])) : null;
    return {
      date,
      sleepHours: sl?.sleepHours ?? null,
      deepMinutes: sl?.deepMinutes ?? null,
      remMinutes: sl?.remMinutes ?? null,
      sleepStart: sl?.sleepStart ?? null,
      sleepEnd: sl?.sleepEnd ?? null,
      stressAvg: st?.stressAvg ?? null,
      stressHighMinutes: st?.stressHighMinutes ?? null,
      bodyBatteryWake,
      ...(last != null ? { dataUntil: clockOf(last) } : {}),
      fetchedAt,
    };
  });
}

/** "HH:MM" on the phone's clock for an epoch time in milliseconds. */
function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---- HTTP ----

export interface GarminClientOptions {
  apiKey: string;
  /** Defaults to Garmin itself. The web version goes through its own /api/garmin hop. */
  baseUrl?: string;
  fetch?: GarminFetch;
  timeoutMs?: number;
  now?: () => number;
}

export class GarminClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly doFetch: GarminFetch;
  private readonly base: string;

  constructor(private readonly opts: GarminClientOptions) {
    this.doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.base = (opts.baseUrl ?? GARMIN_BASE_URL).replace(/\/+$/, '');
  }

  private async request(url: string, init: { method: string; headers: Record<string, string> }): Promise<{ status: number; ok: boolean; body: string }> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000) : null;
    try {
      const res = await this.doFetch(url, { ...init, signal: controller?.signal });
      return { status: res.status, ok: res.ok, body: await res.text() };
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw new GarminError('timeout', 'Garmin svarade inte i tid.');
      throw new GarminError('network', 'Ingen kontakt med Garmin. Kontrollera nätet.');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private fail(status: number): GarminError {
    if (status === 400 || status === 401 || status === 403) {
      return new GarminError('auth', 'Garmin godtog inte nyckeln. Den kan ha gått ut eller tagits bort. Skapa en ny i Garmin Connect.', status);
    }
    if (status === 404) return new GarminError('not_exposed', 'Garmin lämnar inte ut den här datan via din nyckel.', status);
    if (status === 429) return new GarminError('rate_limit', 'Garmin säger att det blivit för många anrop. Försök igen senare.', status);
    return new GarminError('server', `Garmin svarar inte som vanligt just nu (fel ${status}).`, status);
  }

  /** Exchanges the Personal API key for an access token, reusing it until an hour before expiry. */
  async accessToken(force = false): Promise<string> {
    const now = (this.opts.now ?? Date.now)();
    if (!force && this.token && this.token.expiresAt - now > 60 * 60 * 1000) return this.token.value;
    const res = await this.request(this.base + GARMIN_TOKEN_PATH, {
      method: 'POST',
      headers: { Accept: '*/*', Authorization: `ApiKey ${this.opts.apiKey.trim()}` },
    });
    if (!res.ok) throw this.fail(res.status);
    const value = res.body.trim().replace(/^"|"$/g, '');
    this.token = { value, expiresAt: jwtExpiryMs(value) };
    return value;
  }

  /** GET with one retry on 401, since a token can be revoked before it expires. */
  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    const qs = params ? `?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(attempt > 0);
      const res = await this.request(this.base + path + qs, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && attempt === 0) continue;
      if (!res.ok) throw this.fail(res.status);
      if (!res.body.trim()) return null;
      try {
        return JSON.parse(res.body);
      } catch {
        throw new GarminError('bad_answer', 'Garmin gav ett svar som inte gick att läsa.', res.status);
      }
    }
    throw new GarminError('auth', 'Garmin godtog inte nyckeln.', 401);
  }

  /** Sleep, stress and Body Battery for an inclusive date range of at most 28 days. */
  async days(start: DateKey, end: DateKey, fetchedAt = new Date().toISOString()): Promise<GarminDay[]> {
    const sleep = parseSleep(await this.get('/sleep-service/sleep/dailySleepSummariesByDate', { startDate: start, endDate: end }));
    const stress = parseStress(await this.get(`/usersummary-service/stats/stress/daily/${start}/${end}`));
    // Body Battery is a nice-to-have: a failure there must not lose sleep and stress.
    let bb: BodyBatteryRow[] = [];
    try {
      bb = parseBodyBattery(await this.get('/wellness-service/wellness/bodyBattery/reports/daily', { startDate: start, endDate: end }));
    } catch (e) {
      if (e instanceof GarminError && e.kind === 'auth') throw e;
    }
    return mergeDays(sleep, stress, bb, fetchedAt);
  }
}
