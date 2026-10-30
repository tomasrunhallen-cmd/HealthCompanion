import type { FetchLike } from '../src/adapter/http';
import { destinationKey } from '../src/llm/config';
import { formatMeasurements, measuredDays, NO_MEASUREMENTS } from '../src/analysis/measurements';
import { score } from '../src/analysis/scoring';
import type { Entry, GarminDay } from '../src/domain/types';
import {
  GarminClient, GarminError, GARMIN_BASE_URL, GARMIN_TOKEN_PATH, jwtExpiryMs, localClock, mergeDays,
  parseBodyBattery, parseSleep, parseStress, type GarminFetch,
} from '../src/garmin/client';
import { getSecret } from '../src/platform/secrets';
import { scrub } from '../src/privacy/scrub';
import { saveCheckin } from '../src/services/checkin';
import { connectGarmin, disconnectGarmin, GARMIN_KEY_NAME, syncGarmin } from '../src/services/garmin';
import { LLM_KEY_NAME } from '../src/services/llm';
import { setSecret } from '../src/platform/secrets';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

jest.mock('../src/platform/secrets', () => {
  const mem = new Map<string, string>();
  return {
    secretsPersist: false,
    getSecret: async (n: string) => mem.get(n) ?? null,
    setSecret: async (n: string, v: string) => void mem.set(n, v),
    deleteSecret: async (n: string) => void mem.delete(n),
  };
});

function jwt(expSeconds: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ exp: expSeconds, scope: ['PERSONAL_API'] })}.sig`;
}

/** Local wall-clock time encoded as UTC, the way Garmin's "...Local" fields are. */
function local(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h, mi);
}

const NOW = new Date(2026, 9, 30, 21, 0); // Friday 30 October, 21:00 local

function sleepRow(date: string, hours: number, start: [number, number, number, number, number], wrap = true) {
  const [y, mo, d, h, mi] = start;
  const startMs = local(y, mo, d, h, mi);
  const row = {
    calendarDate: date,
    sleepTimeSeconds: Math.round(hours * 3600),
    deepSleepSeconds: 4500,
    remSleepSeconds: 5400,
    sleepStartTimestampLocal: startMs,
    sleepEndTimestampLocal: startMs + hours * 3600_000,
    sleepEndTimestampGMT: startMs + hours * 3600_000 - 3600_000,
  };
  return wrap ? { dailySleepDTO: row } : row;
}

interface Routes {
  token?: { status: number; body: string };
  sleep?: unknown;
  stress?: unknown;
  bb?: unknown;
  dataStatus?: number;
}

function garminFetch(r: Routes): GarminFetch & { calls: { url: string; headers: Record<string, string> }[] } {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f = (async (url, init) => {
    calls.push({ url, headers: init.headers });
    const reply = (status: number, body: string) => ({ ok: status < 300, status, text: async () => body });
    if (url.endsWith(GARMIN_TOKEN_PATH)) return reply(r.token?.status ?? 200, r.token?.body ?? jwt(Date.now() / 1000 + 86400));
    if (r.dataStatus) return reply(r.dataStatus, '');
    if (url.includes('/sleep-service/')) return reply(200, JSON.stringify(r.sleep ?? []));
    if (url.includes('/stats/stress/')) return reply(200, JSON.stringify(r.stress ?? []));
    if (url.includes('/bodyBattery/')) return reply(200, JSON.stringify(r.bb ?? []));
    return reply(404, '');
  }) as GarminFetch & { calls: { url: string; headers: Record<string, string> }[] };
  f.calls = calls;
  return f;
}

const WEEK_SLEEP = [
  sleepRow('2026-10-30', 4.5, [2026, 10, 30, 2, 40]),
  sleepRow('2026-10-29', 7.2, [2026, 10, 28, 23, 10], false),
  sleepRow('2026-10-28', 7.0, [2026, 10, 27, 23, 0]),
  { dailySleepDTO: { calendarDate: '2026-10-27', sleepTimeSeconds: 0 } }, // watch not worn
];
const WEEK_STRESS = [
  { calendarDate: '2026-10-30', values: { overallStressLevel: 48, highStressDuration: 2700 } },
  { calendarDate: '2026-10-29', values: { overallStressLevel: 30, highStressDuration: 600 } },
  { calendarDate: '2026-10-28', values: { overallStressLevel: -1, highStressDuration: 0 } },
];

describe('Garmin client', () => {
  it('exchanges the key for a token with the documented header and reuses it', async () => {
    const f = garminFetch({ sleep: [], stress: [] });
    const c = new GarminClient({ apiKey: ' my-key ', fetch: f });
    await c.days('2026-10-23', '2026-10-30');
    const token = f.calls.filter((x) => x.url.endsWith(GARMIN_TOKEN_PATH));
    expect(token).toHaveLength(1);
    expect(token[0].url).toBe(`${GARMIN_BASE_URL}${GARMIN_TOKEN_PATH}`);
    expect(token[0].headers.Authorization).toBe('ApiKey my-key');
    const data = f.calls.filter((x) => !x.url.endsWith(GARMIN_TOKEN_PATH));
    expect(data.map((x) => x.url.replace(GARMIN_BASE_URL, ''))).toEqual([
      '/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-10-23&endDate=2026-10-30',
      '/usersummary-service/stats/stress/daily/2026-10-23/2026-10-30',
      '/wellness-service/wellness/bodyBattery/reports/daily?startDate=2026-10-23&endDate=2026-10-30',
    ]);
    expect(data.every((x) => /^Bearer .+\..+\..+$/.test(x.headers.Authorization))).toBe(true);
  });

  it('reads the expiry from the token and accepts a quoted token', async () => {
    expect(jwtExpiryMs(jwt(2_000_000_000))).toBe(2_000_000_000_000);
    const f = garminFetch({ token: { status: 200, body: `"${jwt(2_000_000_000)}"\n` } });
    expect(await new GarminClient({ apiKey: 'k', fetch: f }).accessToken()).toBe(jwt(2_000_000_000));
  });

  it('maps a rejected key to a Swedish message', async () => {
    const c = new GarminClient({ apiKey: 'old', fetch: garminFetch({ token: { status: 401, body: '' } }) });
    await expect(c.days('2026-10-23', '2026-10-30')).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('Garmin godtog inte nyckeln') });
  });

  it('gets a new token once when a data call answers 401', async () => {
    let n = 0;
    const f: GarminFetch = async (url) => {
      const reply = (status: number, body: string) => ({ ok: status < 300, status, text: async () => body });
      if (url.endsWith(GARMIN_TOKEN_PATH)) return reply(200, jwt(Date.now() / 1000 + 86400));
      return n++ === 0 ? reply(401, '') : reply(200, '[]');
    };
    await expect(new GarminClient({ apiKey: 'k', fetch: f }).get('/x')).resolves.toEqual([]);
  });

  it('reports network failure', async () => {
    const f: GarminFetch = async () => { throw new TypeError('Network request failed'); };
    await expect(new GarminClient({ apiKey: 'k', fetch: f }).accessToken()).rejects.toBeInstanceOf(GarminError);
  });
});

describe('Garmin parsing', () => {
  it('reads sleep in both shapes, local clock times, and skips nights without sleep', () => {
    const s = parseSleep(WEEK_SLEEP);
    expect(s.map((r) => [r.date, r.sleepHours, r.sleepStart, r.sleepEnd, r.deepMinutes, r.remMinutes])).toEqual([
      ['2026-10-30', 4.5, '02:40', '07:10', 75, 90],
      ['2026-10-29', 7.2, '23:10', '06:22', 75, 90],
      ['2026-10-28', 7, '23:00', '06:00', 75, 90],
    ]);
    expect(localClock(local(2026, 10, 30, 0, 5))).toBe('00:05');
  });

  it('reads stress and treats negative levels as missing', () => {
    expect(parseStress(WEEK_STRESS)).toEqual([
      { date: '2026-10-30', stressAvg: 48, stressHighMinutes: 45 },
      { date: '2026-10-29', stressAvg: 30, stressHighMinutes: 10 },
      { date: '2026-10-28', stressAvg: null, stressHighMinutes: 0 },
    ]);
  });

  it('takes Body Battery at the first reading after waking', () => {
    const sleep = parseSleep([WEEK_SLEEP[0]]);
    const wake = sleep[0].wakeGmtMs!;
    const bb = parseBodyBattery([{ date: '2026-10-30', bodyBatteryValuesArray: [[wake - 60_000, 20], [wake + 180_000, 41], [wake + 360_000, 43]] }]);
    const [day] = mergeDays(sleep, parseStress(WEEK_STRESS.slice(0, 1)), bb, 'now');
    expect(day).toMatchObject({ date: '2026-10-30', sleepHours: 4.5, stressAvg: 48, bodyBatteryWake: 41 });
  });
});

describe('connecting and syncing', () => {
  it('saves the key only when Garmin accepts it', async () => {
    const repo = await Repository.create(memoryBackend());
    const bad = await connectGarmin(repo, 'typo', { fetch: garminFetch({ token: { status: 401, body: '' } }), now: NOW });
    expect(bad.ok).toBe(false);
    expect(await getSecret(GARMIN_KEY_NAME)).toBeNull();
    expect(repo.garminStatus().connected).toBe(false);

    const f = garminFetch({ sleep: WEEK_SLEEP, stress: WEEK_STRESS });
    const good = await connectGarmin(repo, 'real-key', { fetch: f, now: NOW });
    expect(good).toMatchObject({ ok: true, error: null });
    expect(f.calls[1].url).toContain('startDate=2026-10-16&endDate=2026-10-30');
    expect(await getSecret(GARMIN_KEY_NAME)).toBe('real-key');
    expect(repo.garminDay('2026-10-30')).toMatchObject({ sleepHours: 4.5, sleepStart: '02:40', stressAvg: 48 });
    expect(repo.garminStatus()).toMatchObject({ connected: true, lastError: null });

    await disconnectGarmin(repo);
    expect(await getSecret(GARMIN_KEY_NAME)).toBeNull();
    expect(repo.garminStatus().connected).toBe(false);
  });

  it('keeps old data and stores the error when a sync fails', async () => {
    const repo = await Repository.create(memoryBackend());
    await connectGarmin(repo, 'k', { fetch: garminFetch({ sleep: WEEK_SLEEP, stress: WEEK_STRESS }), now: NOW });
    const res = await syncGarmin(repo, { fetch: garminFetch({ dataStatus: 503 }), now: NOW });
    expect(res.ok).toBe(false);
    expect(repo.garminStatus().lastError).toContain('fel 503');
    expect(repo.garminDay('2026-10-30')?.sleepHours).toBe(4.5);
  });
});

function entry(date: string, over: Partial<Entry> = {}): Entry {
  return {
    id: `e_${date}`, date, createdAt: new Date(`${date}T21:00:00`).toISOString(), kind: 'checkin',
    transcript: 'Vanlig dag.', mood: 5, energy: 5, wordsPerMinute: null, sleepHours: 7, sleepSource: 'garmin', stressAvg: null,
    ...over,
  };
}

function gday(date: string, over: Partial<GarminDay> = {}): GarminDay {
  return {
    date, sleepHours: 7, deepMinutes: 80, remMinutes: 90, sleepStart: '23:00', sleepEnd: '06:00',
    stressAvg: 30, stressHighMinutes: 10, bodyBatteryWake: 70, fetchedAt: '', ...over,
  };
}

const PLAN_SETTINGS = { normalState: '', sleepThresholdHours: 5 };

describe('scoring with Garmin', () => {
  it('falling asleep after 02:00 with no entry the evening before gives two points', () => {
    const r = score({
      entry: entry('2026-10-30', { sleepHours: 6 }), matches: [], plan: [], planSettings: PLAN_SETTINGS,
      history: [{ entry: entry('2026-10-28'), level: 'green' }],
      garmin: { '2026-10-30': gday('2026-10-30', { sleepStart: '02:40', sleepHours: 6 }) },
    });
    expect(r.signals).toEqual([expect.objectContaining({ kind: 'late_sleep_no_entry', points: 2, measured: true })]);
    expect(r.level).toBe('yellow');
  });

  it('does not count late sleep when there was an entry the evening before, or a daytime nap', () => {
    const withEntry = score({
      entry: entry('2026-10-30'), matches: [], plan: [], planSettings: PLAN_SETTINGS,
      history: [{ entry: entry('2026-10-29'), level: 'green' }],
      garmin: { '2026-10-30': gday('2026-10-30', { sleepStart: '03:00' }) },
    });
    expect(withEntry.signals).toEqual([]);
    const nap = score({
      entry: entry('2026-10-30'), matches: [], plan: [], planSettings: PLAN_SETTINGS, history: [],
      garmin: { '2026-10-30': gday('2026-10-30', { sleepStart: '13:30' }) },
    });
    expect(nap.signals).toEqual([]);
  });

  it('counts two short nights in a row even when yesterday had no entry', () => {
    const r = score({
      entry: entry('2026-10-30', { sleepHours: 4 }), matches: [], plan: [], planSettings: PLAN_SETTINGS,
      history: [{ entry: entry('2026-10-29'), level: 'green' }],
      garmin: { '2026-10-29': gday('2026-10-29', { sleepHours: 4.5 }) },
    });
    expect(r.signals.map((s) => s.kind)).toEqual(['sleep_low', 'sleep_low_consecutive']);
  });
});

describe('measurements for the model', () => {
  it('describes today in detail and the week day by day, newest first', () => {
    const garmin = {
      '2026-10-30': gday('2026-10-30', { sleepHours: 4.5, sleepStart: '02:40', sleepEnd: '07:10', stressAvg: 48, stressHighMinutes: 45, bodyBatteryWake: 41 }),
      '2026-10-29': gday('2026-10-29', { sleepHours: 7.2, sleepStart: '23:10', stressAvg: 30 }),
    };
    const text = formatMeasurements(measuredDays(entry('2026-10-30'), [{ entry: entry('2026-10-27', { sleepHours: 6, sleepSource: 'transcript', stressAvg: null }), level: 'green' }], garmin), 31);
    expect(text).toContain('I dag, fredag 30 oktober:');
    expect(text).toContain('- Sömn natten innan: 4,5 h, somnade 02:40, vaknade 07:10, djupsömn 80 min, REM 90 min');
    expect(text).toContain('- Body Battery vid uppvaknandet: 41 av 100');
    expect(text).toContain('- Stress hittills i dag: snitt 48 av 100, hög stress 45 min');
    expect(text).toContain('- torsdag 29 oktober: sömn 7,2 h, somnade 23:10, stress 30');
    expect(text).toContain('- tisdag 27 oktober: sömn 6 h (skattat ur anteckningen, inte mätt)');
    expect(text).toContain('- fredag 23 oktober: inga mätvärden');
    expect(text).toContain('Snitt veckan innan: sömn 7,2 h, stress 30.');
    expect(text).toContain('Personens vanliga stress på gröna dagar: 31.');
    // Nothing in the block looks like personal data, so scrubbing leaves it unchanged.
    expect(scrub(text, ['Kim']).text).toBe(text);
  });

  it('says so when there is nothing measured', () => {
    expect(formatMeasurements(measuredDays(entry('2026-10-30', { sleepHours: null, sleepSource: null }), [], {}))).toBe(NO_MEASUREMENTS);
  });
});

describe('check-in with Garmin and a language model', () => {
  it('uses today\'s Garmin values and sends the day and week to the model', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addPlanItems([{ id: 's1', kind: 'early', text: 'Svarar inte på sms' }]);
    await repo.updateSettings({ scrubNames: ['Kim'] });
    await repo.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest', consentFor: destinationKey('mistral', '') });
    await setSecret(LLM_KEY_NAME, 'mk');
    await connectGarmin(repo, 'gk', { fetch: garminFetch({ sleep: WEEK_SLEEP, stress: WEEK_STRESS }), now: NOW });

    const sent: any[] = [];
    const llm: FetchLike = async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"matches":[],"sentence":"Du sov 4,5 timmar i natt mot drygt 7 i veckan."}' } }] }) };
    };
    // A later sync during the check-in refreshes today's stress.
    const later = garminFetch({ sleep: [WEEK_SLEEP[0]], stress: [{ calendarDate: '2026-10-30', values: { overallStressLevel: 52, highStressDuration: 3600 } }] });
    const { entry: e, assessment } = await saveCheckin(
      repo, { transcript: 'Lugn kväll. Kim ringde.', mood: 5, energy: 5, wordsPerMinute: null }, NOW, { fetch: llm }, { fetch: later },
    );
    expect(later.calls.some((c) => c.url.includes('/stats/stress/daily/2026-10-29/2026-10-30'))).toBe(true);
    expect(e).toMatchObject({ sleepHours: 4.5, sleepSource: 'garmin', stressAvg: 52 });
    const user = sent[0].messages[1].content as string;
    expect(user).toContain('Mätvärden:\nVärdena är mätta av personens klocka (Garmin)');
    expect(user).toContain('Sömn natten innan: 4,5 h, somnade 02:40');
    expect(user).toContain('Stress hittills i dag: snitt 52 av 100, hög stress 60 min');
    expect(user).toContain('torsdag 29 oktober: sömn 7,2 h, somnade 23:10, stress 30');
    expect(user).not.toContain('Kim');
    expect(assessment.sentence).toBe('Du sov 4,5 timmar i natt mot drygt 7 i veckan.');
    // 4.5 h under the 5 h limit, and asleep at 02:40 with no entry the evening before.
    expect(assessment.signals.map((s) => s.kind).sort()).toEqual(['late_sleep_no_entry', 'sleep_low']);
    expect(assessment.level).toBe('yellow');
  });

  it('still saves the check-in with stored values when Garmin cannot be reached', async () => {
    const repo = await Repository.create(memoryBackend());
    await connectGarmin(repo, 'gk', { fetch: garminFetch({ sleep: WEEK_SLEEP, stress: WEEK_STRESS }), now: NOW });
    const down: GarminFetch = async () => { throw new TypeError('offline'); };
    const { entry: e, assessment } = await saveCheckin(repo, { transcript: 'Sov sju timmar.', mood: 5, energy: 5, wordsPerMinute: null }, NOW, {}, { fetch: down });
    expect(e).toMatchObject({ sleepHours: 4.5, sleepSource: 'garmin', stressAvg: 48 });
    expect(assessment.method).toBe('wordmatch');
    expect(repo.garminStatus().lastError).toContain('Ingen kontakt med Garmin');
  });
});
