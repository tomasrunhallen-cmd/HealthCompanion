import type { DateKey, Entry, PlanItem } from '../src/core/domain/types';
import { GARMIN_TOKEN_PATH, type GarminFetch } from '../src/garmin/client';
import {
  medicationOf, moodOf, parseCsv, parseDiaryFile, parseDiaryFiles, parseSwedishDate, signalsOf, sleepFromNote,
} from '../src/import/bipolarDagbok';
import { buildImport, signalCounts, suggestMapping } from '../src/import/transform';
import { setSecret } from '../src/platform/secrets';
import { runDiaryImport } from '../src/services/diaryImport';
import { GARMIN_KEY_NAME } from '../src/services/garmin';
import { backfillGarmin, backfillState, ROUND_DAYS } from '../src/services/garminHistory';
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

// The diary's real header, with invented rows below.
const HEADER = 'Datum,Dag,Högt Humör,Lågt Humör,Medicin,Sömnavvikelse,Stress-symptom,Högt Engagemang,Nåt BRA har hänt,Nåt DÅLIGT har hänt,Stor oro,Ett ekonomiskt hållbart val,Sluta jobb i tid,Utomhus på lunchen,Jobba med 30 min timer,Använt SORK,Träning,Mindfulness,Bad/Kallbad,Psykolog,Läkarbesök,Alkohol,Social Aktivitet,Ångest,Leta Efter Information ,Allt Bara Funkar,Hög Energi,Handlat Mer Än Vanligt,Jag mår äntligen bra,Känner mig mindful ,Högt självförtroende ,Lyssnar på hetsig och hög musik,Upplevd brådska för något,Upplevt starkt magstöd vid prat och sång,Energi flödar i kroppen,Många ideer på jobbet,Svårt att vänta när andra pratar,Ser sammanhang tydligt,Handlat något ovanligt,Jag är smartare än andra ,Spontan ex inlägg på sociala medier,Dofter och färger är tydligare,Upplever att jag måste bromsa hjärnan,Anteckningar';
const COLS = HEADER.split(',');

/** One row: Swedish date, weekday, then values by column name (default NEJ), then the note. */
function row(date: string, day: string, values: Record<string, string> = {}, note = '') {
  const cells = COLS.map((c) => {
    if (c === 'Datum') return date;
    if (c === 'Dag') return day;
    if (c === 'Anteckningar') return `"${note.replace(/"/g, '""')}"`;
    if (c === 'Högt Humör' || c === 'Lågt Humör') return values[c] ?? 'Balanserad';
    if (c === 'Medicin') return values[c] ?? 'JA';
    return values[c.trim()] ?? values[c] ?? 'NEJ';
  });
  return cells.join(',');
}
const dash = (date: string, day: string) => COLS.map((c) => (c === 'Datum' ? date : c === 'Dag' ? day : '-')).join(',');

const FILE_A = [
  HEADER,
  dash('01 mars 2024', 'fredag'),
  row('02 mars 2024', 'lördag', {}, 'Lugn dag.\n\nSömn: Sov gott ca 7 h'),
  row('03 mars 2024', 'söndag', { Ångest: 'JA', 'Lågt Humör': 'Nedstämdhet', 'Högt Humör': 'Glädje' }, 'Orolig hela dagen, sa "nej" till allt.'),
  row('04 mars 2024', 'måndag', { Medicin: 'NEJ', Alkohol: 'JA' }, 'Middag med vänner.'),
  row('05 mars 2024', 'tisdag', { Medicin: 'NEJ', 'Handlat Mer Än Vanligt': 'JA' }, 'Sömn: Kort natt. Ca 6 h 45 min'),
].join('\r\n');
const FILE_B = [
  HEADER,
  row('05 mars 2024', 'tisdag', {}, 'Dubblett som ska hoppas över.'),
  row('06 mars 2024', 'onsdag', { 'Lågt Humör': 'Depression' }, 'Jag vill inte leva längre.'),
].join('\n');

const PLAN: PlanItem[] = [
  { id: 'oro', kind: 'early', text: 'Oro och ångest flera dagar', order: 0, approvedAt: '2026-01-01' },
  { id: 'handla', kind: 'early', text: 'Handlar saker jag inte behöver', order: 1, approvedAt: '2026-01-01' },
  { id: 'ata', kind: 'serious', text: 'Slutar äta', order: 0, approvedAt: '2026-01-01' },
];
const PS = { normalState: '', sleepThresholdHours: 5 };

describe('reading the diary\'s CSV', () => {
  it('handles quoted fields with commas, line breaks and doubled quotes', () => {
    expect(parseCsv('a,b\r\n1,"x, ""y""\nz"\n')).toEqual([['a', 'b'], ['1', 'x, "y"\nz']]);
  });

  it('reads Swedish dates and refuses impossible ones', () => {
    expect(parseSwedishDate('03 november 2020')).toBe('2020-11-03');
    expect(parseSwedishDate('1 maj 2025')).toBe('2025-05-01');
    expect(parseSwedishDate('31 februari 2024')).toBeNull();
    expect(parseSwedishDate('igår')).toBeNull();
  });

  it('skips days where nothing was filled in and reads "-" as an empty note', () => {
    const f = parseDiaryFile('2024.csv', FILE_A);
    expect(f.empty).toBe(1);
    expect(f.days.map((d) => d.date)).toEqual(['2024-03-02', '2024-03-03', '2024-03-04', '2024-03-05']);
    expect(f.days[1].note).toBe('Orolig hela dagen, sa "nej" till allt.');
    expect(f.days[0].note).toBe('Lugn dag.\n\nSömn: Sov gott ca 7 h');
  });

  it('refuses a file that is not the diary\'s report', () => {
    expect(() => parseDiaryFile('annat.csv', 'Date,Mood\n2024-01-01,5')).toThrow('ser inte ut som en rapport');
  });

  it('joins several files, oldest first, keeping the first of a duplicated date', () => {
    const p = parseDiaryFiles([{ name: 'b.csv', text: FILE_B }, { name: 'a.csv', text: FILE_A }]);
    expect(p.days.map((d) => d.date)).toEqual(['2024-03-02', '2024-03-03', '2024-03-04', '2024-03-05', '2024-03-06']);
    expect(p.duplicates).toBe(1);
    expect(p.days.find((d) => d.date === '2024-03-05')!.note).toBe('Dubblett som ska hoppas över.');
  });
});

describe('the day\'s values', () => {
  const days = parseDiaryFile('a.csv', FILE_A).days;

  it('lists each "JA" and each mood other than Balanserad; medication and alcohol are not listed', () => {
    expect(signalsOf(days[1]).sort()).toEqual(['Högt Humör: Glädje', 'Lågt Humör: Nedstämdhet', 'Ångest']);
    expect(signalsOf(days[2])).toEqual([]);
    expect(signalCounts(days).map((c) => c.signal)).toContain('Handlat Mer Än Vanligt');
  });

  it('mood: Balanserad is 5, the low side wins on a day with both', () => {
    expect(moodOf(days[0])).toBe(5);
    expect(moodOf(days[1])).toBe(4);
    expect(medicationOf(days[2])).toBe(false);
    expect(medicationOf(days[0])).toBe(true);
  });

  it.each([
    ['Sömn: Sov gott ca 7 h', 7],
    ['Sömn: Sov lugnt ca 7:30 h', 7.5],
    ['Sömn: Sov ok. Ungefär 7.5-8 h', 7.75],
    ['Sömn: Sov tungt 8+ h', 8],
    ['Sömn: Somnade sent. Ca 6 h 45 min', 6.75],
    ['Sömn: Vaknade ofta. 2 h 30 min vaken', null],
    ['Jobbade 3 h extra.\nSömn: bra', null],
  ])('reads sleep from "%s"', (note, hours) => {
    expect(sleepFromNote(note)).toBe(hours);
  });
});

describe('suggested mapping', () => {
  it('links items that share a word with a sign, and ignores everything else', () => {
    expect(suggestMapping(['Handlat Mer Än Vanligt', 'Ångest', 'Träning', 'Lågt Humör: Nedstämdhet'], PLAN)).toEqual({
      'Handlat Mer Än Vanligt': 'handla', Ångest: 'oro', Träning: null, 'Lågt Humör: Nedstämdhet': null,
    });
  });
});

describe('building the imported days', () => {
  const parsed = parseDiaryFiles([{ name: 'a.csv', text: FILE_A }, { name: 'b.csv', text: FILE_B }]);
  const build = (over: Partial<Parameters<typeof buildImport>[0]> = {}) => buildImport({
    importId: 'imp1', days: parsed.days, mapping: { Ångest: 'oro', 'Handlat Mer Än Vanligt': 'handla' }, plan: PLAN, planSettings: PS,
    entries: [], assessments: [], context: [], garmin: {}, now: new Date(2026, 10, 1, 12), ...over,
  });

  it('makes one imported day per filled-in date, with the note, mood and the original values', async () => {
    const r = await build();
    const e = r.entries.find((x) => x.date === '2024-03-03')!;
    expect(e).toMatchObject({ kind: 'imported', transcript: 'Orolig hela dagen, sa "nej" till allt.', mood: 4, energy: null, wordsPerMinute: null });
    expect(new Date(e.createdAt).getHours()).toBe(21);
    expect(e.imported).toEqual({ importId: 'imp1', source: 'bipolar-dagbok', values: { 'Högt Humör': 'Glädje', 'Lågt Humör': 'Nedstämdhet', Medicin: 'JA', Ångest: 'JA' } });
  });

  it('a mapped "JA" gives the sign\'s point, with the column as the quote; an unmapped one gives nothing', async () => {
    const r = await build();
    const a = r.assessments.find((x) => x.date === '2024-03-03')!;
    expect(a.method).toBe('import');
    expect(a.signals.filter((s) => s.kind === 'early_sign')).toEqual([
      expect.objectContaining({ planItemId: 'oro', quote: 'Bipolär dagbok: Ångest', points: 1 }),
    ]);
    const none = await build({ mapping: {} });
    expect(none.assessments.find((x) => x.date === '2024-03-03')!.signals.some((s) => s.kind === 'early_sign')).toBe(false);
  });

  it('medication "NEJ" two evenings in a row gives the medication point; only "NEJ" answers are saved', async () => {
    const r = await build();
    expect(r.context.map((c) => [c.kind, c.date, c.taken, c.importId])).toEqual([
      ['medication_taken', '2024-03-04', false, 'imp1'],
      ['medication_taken', '2024-03-05', false, 'imp1'],
    ]);
    const a = r.assessments.find((x) => x.date === '2024-03-05')!;
    expect(a.signals.map((s) => s.kind)).toEqual(expect.arrayContaining(['medication_missed', 'early_sign']));
  });

  it('alcohol "JA" counts as yes to alcohol yesterday on the next day', async () => {
    const r = await build();
    expect(r.entries.find((x) => x.date === '2024-03-05')!.strainYesterday).toBe(true);
    expect(r.entries.find((x) => x.date === '2024-03-04')!.strainYesterday).toBeUndefined();
  });

  it('the emergency rule runs on every note: a red day, marked akut', async () => {
    const r = await build();
    const a = r.assessments.find((x) => x.date === '2024-03-06')!;
    expect([a.level, a.akut, a.levelReason]).toEqual(['red', true, 'akut']);
    expect(r.akut).toBe(1);
  });

  it('sleep from Garmin first, then the note\'s Sömn: line; stress from Garmin', async () => {
    const g = (date: DateKey, sleepHours: number, stressAvg: number) => ({
      date, sleepHours, deepMinutes: null, remMinutes: null, sleepStart: null, sleepEnd: null, stressAvg,
      stressHighMinutes: null, bodyBatteryWake: null, fetchedAt: '',
    });
    const r = await build({ garmin: { '2024-03-02': g('2024-03-02', 6.2, 31) } });
    expect(r.entries.find((x) => x.date === '2024-03-02')).toMatchObject({ sleepHours: 6.2, sleepSource: 'garmin', stressAvg: 31 });
    expect(r.entries.find((x) => x.date === '2024-03-05')).toMatchObject({ sleepHours: 6.75, sleepSource: 'transcript', stressAvg: null });
    expect([r.sleepFromGarmin, r.sleepFromNote]).toEqual([1, 1]);
  });

  it('never replaces a day written in Dagsljus', async () => {
    const own: Entry = { id: 'own', date: '2024-03-03', createdAt: '2024-03-03T20:00:00', kind: 'checkin', transcript: 'Min egen.', mood: 6, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null };
    const r = await build({ entries: [own] });
    expect(r.skipped).toEqual(['2024-03-03']);
    expect(r.entries.some((x) => x.date === '2024-03-03')).toBe(false);
  });

  it('earlier imported days count as history for later ones', async () => {
    const yellow = (n: number) => row(`${n} april 2024`, 'dag', { Ångest: 'JA' }, 'Orolig.');
    const p = parseDiaryFiles([{ name: 'c.csv', text: [HEADER, yellow(1), yellow(2), yellow(3), row('4 april 2024', 'dag', { Ångest: 'JA', 'Handlat Mer Än Vanligt': 'JA' }, 'Orolig och handlade.')].join('\n') }]);
    const r = await build({ days: p.days });
    expect(r.assessments.map((a) => a.level)).toEqual(['yellow', 'yellow', 'yellow', 'red']);
    expect(r.assessments[3].levelReason).toBe('recent_days');
  });
});

describe('saving and removing an import', () => {
  it('saves days, assessments and medication answers, and removes exactly those again', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addPlanItems(PLAN.map((p) => ({ id: p.id, kind: p.kind, text: p.text })));
    const own: Entry = { id: 'own', date: '2024-03-03', createdAt: '2024-03-03T20:00:00', kind: 'checkin', transcript: 'Min egen.', mood: 6, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null };
    const ownA = (await buildImport({ importId: 'x', days: [], mapping: {}, plan: PLAN, planSettings: PS, entries: [], assessments: [], context: [], garmin: {}, now: new Date() })).assessments[0];
    expect(ownA).toBeUndefined();
    await repo.saveEntry(own, { id: 'ownA', entryId: 'own', date: '2024-03-03', createdAt: '', level: 'green', points: 0, signals: [], sentence: '', method: 'wordmatch', model: null, promptId: null, promptVersion: null, baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 } });
    const parsed = parseDiaryFiles([{ name: 'a.csv', text: FILE_A }]);
    const { record, result } = await runDiaryImport(repo, parsed, { Ångest: 'oro' }, { now: new Date(2026, 10, 1) });
    expect(result.entries).toHaveLength(3);
    expect(record).toMatchObject({ source: 'bipolar-dagbok', from: '2024-03-02', to: '2024-03-05', days: 3, skipped: 1, mapping: { Ångest: 'oro' } });
    expect(repo.entries()).toHaveLength(4);
    expect(repo.contextOf('medication_taken')).toHaveLength(2);
    expect(repo.assessmentsByEntry().get(`${record.id}_2024-03-02`)?.level).toBe('green');

    expect(await repo.removeImport(record.id)).toBe(3);
    expect(repo.entries().map((e) => e.id)).toEqual(['own']);
    expect(repo.assessments().map((a) => a.id)).toEqual(['ownA']);
    expect(repo.contextOf('medication_taken')).toEqual([]);
    expect(repo.imports()).toEqual([]);
  });
});

describe('Garmin for the same period', () => {
  function jwt(): string {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'none' })}.${b64({ exp: Date.now() / 1000 + 86400 })}.sig`;
  }
  /** Fake Garmin with sleep and stress for every day from `oldest`, and optional failures. */
  function garmin(oldest: DateKey, opts: { failAt?: number } = {}): GarminFetch & { ranges: string[] } {
    let calls = 0;
    const ranges: string[] = [];
    const f = (async (url: string) => {
      const reply = (status: number, body: string) => ({ ok: status < 300, status, text: async () => body });
      if (url.endsWith(GARMIN_TOKEN_PATH)) return reply(200, jwt());
      calls++;
      if (opts.failAt && calls >= opts.failAt) return reply(429, '');
      const m = url.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/)!;
      const [start, end] = [m[1], m[2]];
      const days: DateKey[] = [];
      for (let d = new Date(`${start}T12:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const k = d.toISOString().slice(0, 10);
        if (k >= oldest) days.push(k);
      }
      if (url.includes('/sleep-service/')) {
        ranges.push(`${start}..${end}`);
        return reply(200, JSON.stringify(days.map((k) => ({ dailySleepDTO: { calendarDate: k, sleepTimeSeconds: 7 * 3600 } }))));
      }
      if (url.includes('/stats/stress/')) return reply(200, JSON.stringify(days.map((k) => ({ calendarDate: k, values: { overallStressLevel: 30 } }))));
      return reply(200, '[]');
    }) as unknown as GarminFetch & { ranges: string[] };
    f.ranges = ranges;
    return f;
  }

  it('fetches newest first, 28 days at a time, into an archive per month, and stops when Garmin has nothing older', async () => {
    const repo = await Repository.create(memoryBackend());
    await setSecret(GARMIN_KEY_NAME, 'key');
    const f = garmin('2024-03-10');
    const r = await backfillGarmin(repo, '2023-06-01', '2024-04-30', { fetch: f, pauseMs: 0, now: new Date(2026, 10, 1) });
    expect(r).toMatchObject({ done: true, error: null });
    expect(f.ranges[0]).toBe(`2024-04-03..2024-04-30`);
    expect(f.ranges[1]).toBe(`2024-03-06..2024-04-02`);
    // Three empty rounds in a row after the oldest data, then stop.
    expect(f.ranges).toHaveLength(5);
    expect(r.state.oldestWithData).toBe('2024-03-10');
    expect(r.state.fetchedDays).toBe(52);
    expect(Object.keys(repo.garminArchive())).toHaveLength(52);
    expect(repo.kvGet('garminMonth:2024-03')).toBeTruthy();
    expect(repo.allGarminDays()['2024-04-30']).toMatchObject({ sleepHours: 7, stressAvg: 30 });
    expect(ROUND_DAYS).toBe(28);
  });

  it('a stop from Garmin keeps the progress, and the next run continues where it left off', async () => {
    const repo = await Repository.create(memoryBackend());
    await setSecret(GARMIN_KEY_NAME, 'key');
    const first = await backfillGarmin(repo, '2024-01-01', '2024-04-30', { fetch: garmin('2020-01-01', { failAt: 7 }), pauseMs: 0, now: new Date(2026, 10, 1) });
    expect(first.done).toBe(false);
    expect(first.error).toContain('fortsätter där den slutade');
    expect(backfillState(repo)?.nextEnd).toBe('2024-03-05');
    const f = garmin('2020-01-01');
    const second = await backfillGarmin(repo, '2024-01-01', '2024-04-30', { fetch: f, pauseMs: 0, now: new Date(2026, 10, 1) });
    expect(second.done).toBe(true);
    expect(f.ranges[0]).toBe('2024-02-07..2024-03-05');
    expect(Object.keys(repo.garminArchive())).toHaveLength(121);
  });

  it('never asks for days after today', async () => {
    const repo = await Repository.create(memoryBackend());
    await setSecret(GARMIN_KEY_NAME, 'key');
    const f = garmin('2020-01-01');
    await backfillGarmin(repo, '2026-10-20', '2026-11-30', { fetch: f, pauseMs: 0, now: new Date(2026, 10, 1, 12) });
    expect(f.ranges[0]).toBe('2026-10-20..2026-11-01');
  });
});
