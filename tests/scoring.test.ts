import { assessEntry, displaySentence, wordMatcher, templateSentence, NOTHING_STANDS_OUT, firstStep, seriousActions, type SignMatcher } from '../src/core/analysis/assess';
import { addDays, eveningDateKey } from '../src/core/analysis/dates';
import { buildTrend } from '../src/core/analysis/trend';
import { computeBaseline, levelFromSignals, score, silentDaysBefore, silentDaysUntil, trendLines } from '../src/core/analysis/scoring';
import { loadTestSuite } from '../src/core/analysis/testcases';
import { matchSigns } from '../src/core/analysis/wordmatch';
import type { Entry, PlanItem } from '../src/core/domain/types';

const suite = loadTestSuite();

describe('test cases from prompts/testfall.md with word matching', () => {
  it('the short-night case is yellow: measured signs only count towards red from the second day', () => {
    const c = suite.cases.find((x) => x.id === 'kort-somn-snabbt-tal-natt')!;
    const r = score({ entry: c.entry, matches: [], plan: suite.plan, planSettings: suite.planSettings, history: c.history });
    expect(r.signals.map((s) => s.kind).sort()).toEqual(['night_entry', 'sleep_low', 'speech_fast']);
    expect(r.points).toBe(3);
    expect(r.level).toBe('yellow');
  });

  it('the sms case matches the plan sign with a verbatim quote', () => {
    const c = suite.cases.find((x) => x.id === 'orkade-inte-svara')!;
    const m = matchSigns(c.entry.transcript, suite.plan);
    expect(m).toEqual([{ planItemId: 's1', quote: 'Orkade inte svara på sms i dag' }]);
  });
});

function entry(partial: Partial<Entry> & { date: string }): Entry {
  return {
    id: `e_${partial.date}_${Math.random()}`,
    createdAt: `${partial.date}T21:00:00`,
    kind: 'checkin',
    transcript: '',
    mood: 0, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null,
    ...partial,
  };
}

const plan: PlanItem[] = [
  { id: 'e1', kind: 'early', text: 'Sover mindre', order: 0, approvedAt: '' },
  { id: 'r1', kind: 'serious', text: 'Slutar äta', order: 0, approvedAt: '' },
  { id: 'y1', kind: 'action_yellow', text: 'Ring Kim', order: 1, approvedAt: '' },
  { id: 'y0', kind: 'action_yellow', text: 'Gå och lägg dig före 23', order: 0, approvedAt: '' },
  { id: 'a0', kind: 'action_red', text: 'Ring psykiatriska mottagningen', order: 0, approvedAt: '' },
];
const ps = { normalState: '', sleepThresholdHours: 5 };

describe('level rules', () => {
  const sig = (kind: any, points: number, measured = false) => ({ kind, points, label: '', measured });

  it('green at 0, yellow at 1, red at 4', () => {
    expect(levelFromSignals([], 0).level).toBe('green');
    expect(levelFromSignals([sig('early_sign', 1)], 0).level).toBe('yellow');
    expect(levelFromSignals([sig('early_sign', 1), sig('early_sign', 1), sig('early_sign', 1)], 0).level).toBe('yellow');
    expect(levelFromSignals([sig('early_sign', 1), sig('early_sign', 1), sig('early_sign', 1), sig('early_sign', 1)], 0).level).toBe('red');
  });

  it('a serious sign alone is yellow, with one more sign it is red', () => {
    expect(levelFromSignals([sig('serious_sign', 2)], 0).level).toBe('yellow');
    expect(levelFromSignals([sig('serious_sign', 2), sig('silence', 1, true)], 0).level).toBe('red');
  });

  it('2 points is red when at least 3 of the last 7 days were yellow or red', () => {
    const two = [sig('early_sign', 1), sig('early_sign', 1)];
    expect(levelFromSignals(two, 2).level).toBe('yellow');
    expect(levelFromSignals(two, 3).level).toBe('red');
  });
});

describe('measured signals', () => {
  const greenWeek = Array.from({ length: 7 }, (_, i) => ({
    entry: entry({ date: addDays('2026-10-20', -(i + 1)), wordsPerMinute: 120, stressAvg: 30, sleepHours: 7.5 }),
    level: 'green' as const,
  }));

  it('baseline uses green days only', () => {
    const withYellow = [...greenWeek, { entry: entry({ date: '2026-10-12', wordsPerMinute: 300 }), level: 'yellow' as const }];
    // 2026-10-20 is a Tuesday: the week's baseline uses green days before Monday 2026-10-19.
    expect(computeBaseline('2026-10-20', withYellow)).toEqual({
      wordsPerMinute: 120, stressAvg: 30, greenDays: 6, sleepHours: 7.5, entryTime: '21:00', weekOf: '2026-10-19',
    });
  });

  it('baseline is the same for every day of a week and changes on Monday', () => {
    const days = ['2026-10-19', '2026-10-21', '2026-10-25'].map((d) => computeBaseline(d, greenWeek));
    expect(days.every((b) => JSON.stringify(b) === JSON.stringify(days[0]))).toBe(true);
    expect(computeBaseline('2026-10-26', greenWeek).greenDays).toBe(7);
  });

  it('usual check-in time averages across midnight', () => {
    const late = ['21:30', '23:30', '01:30'].map((t, i) => {
      const date = addDays('2026-10-12', i);
      const [h, m] = t.split(':').map(Number);
      const at = new Date(2026, 9, 12 + i + (h < 5 ? 1 : 0), h, m);
      return { entry: entry({ date, createdAt: at.toISOString() }), level: 'green' as const };
    });
    expect(computeBaseline('2026-10-20', late).entryTime).toBe('23:30');
  });

  it('baseline needs at least three green days', () => {
    expect(computeBaseline('2026-10-20', greenWeek.slice(0, 2)).wordsPerMinute).toBeNull();
  });

  it('speech more than 25 percent above baseline counts', () => {
    const at = (wpm: number) =>
      score({ entry: entry({ date: '2026-10-20', wordsPerMinute: wpm }), matches: [], plan, planSettings: ps, history: greenWeek })
        .signals.some((s) => s.kind === 'speech_fast');
    expect(at(150)).toBe(false);
    expect(at(151)).toBe(true);
  });

  it('stress above 1.3 times baseline counts', () => {
    const r = score({ entry: entry({ date: '2026-10-20', stressAvg: 40 }), matches: [], plan, planSettings: ps, history: greenWeek });
    expect(r.signals.map((s) => s.kind)).toContain('stress_high');
  });

  it('two short nights in a row count as two', () => {
    const hist = [{ entry: entry({ date: '2026-10-19', sleepHours: 4 }), level: 'yellow' as const }];
    const r = score({ entry: entry({ date: '2026-10-20', sleepHours: 4.5 }), matches: [], plan, planSettings: ps, history: hist });
    expect(r.signals.filter((s) => s.kind.startsWith('sleep')).length).toBe(2);
  });

  it('sleep estimated from the note is labelled as estimated', () => {
    const r = score({ entry: entry({ date: '2026-10-20', sleepHours: 3, sleepSource: 'transcript' }), matches: [], plan, planSettings: ps, history: [] });
    expect(r.signals[0].label).toContain('skattat');
  });

  it('a jump of 2.5 in mood or energy gives one point', () => {
    const r = score({ entry: entry({ date: '2026-10-20', mood: 2, energy: 9 }), matches: [], plan, planSettings: ps, history: greenWeek });
    const jumps = r.signals.filter((s) => s.kind === 'mood_jump' || s.kind === 'energy_jump');
    expect(jumps).toHaveLength(1);
    expect(jumps[0].points).toBe(1);
  });

  it('"Orkar bara trycka" gives yellow', () => {
    const r = score({ entry: entry({ date: '2026-10-20', kind: 'heavy', mood: null, energy: null }), matches: [], plan, planSettings: ps, history: greenWeek });
    expect(r.level).toBe('yellow');
  });
});

describe('silence', () => {
  it('counts days without entries before a day', () => {
    const h = [{ entry: entry({ date: '2026-10-17' }), level: 'green' as const }];
    expect(silentDaysBefore('2026-10-18', h)).toBe(0);
    expect(silentDaysBefore('2026-10-20', h)).toBe(2);
    expect(silentDaysBefore('2026-10-20', [])).toBe(0);
  });

  it('home screen counts days up to today', () => {
    expect(silentDaysUntil('2026-10-20', [entry({ date: '2026-10-19' })])).toBe(0);
    expect(silentDaysUntil('2026-10-20', [entry({ date: '2026-10-18' })])).toBe(1);
    expect(silentDaysUntil('2026-10-20', [entry({ date: '2026-10-17' })])).toBe(2);
    expect(silentDaysUntil('2026-10-20', [entry({ date: '2026-10-20' })])).toBe(0);
    expect(silentDaysUntil('2026-10-20', [])).toBe(0);
  });

  it('entries before 04:00 belong to the previous day', () => {
    expect(eveningDateKey(new Date(2026, 9, 21, 1, 15))).toBe('2026-10-20');
    expect(eveningDateKey(new Date(2026, 9, 21, 3, 59))).toBe('2026-10-20');
    expect(eveningDateKey(new Date(2026, 9, 21, 4, 0))).toBe('2026-10-21');
  });
});

describe('sentence and actions', () => {
  it('uses the template sentence when nothing stands out', () => {
    expect(templateSentence([])).toBe(NOTHING_STANDS_OUT);
  });

  it('names the user\'s own sign', () => {
    expect(templateSentence([{ kind: 'early_sign', points: 1, label: 'Sover mindre', measured: false }])).toContain('Sover mindre');
  });

  it('first step follows the plan order', () => {
    expect(firstStep('yellow', plan)?.text).toBe('Gå och lägg dig före 23');
    expect(firstStep('red', plan)?.text).toBe('Ring psykiatriska mottagningen');
  });

  it('a failing matcher falls back to word matching and says so', async () => {
    const a = await assessEntry({
      entry: entry({ date: '2026-10-20', transcript: 'Jag sover mindre nu.' }), plan, planSettings: ps, history: [],
      matcher: { match: async () => { throw new Error('nät nere'); } },
    });
    expect(a.method).toBe('llm_fallback');
    expect(a.level).toBe('yellow');
  });
});

describe('a serious sign shows the plan\'s actions at red', () => {
  const plan: PlanItem[] = [
    { id: 's', kind: 'serious', text: 'Slutar äta', order: 0, approvedAt: '2026-01-01' },
    { id: 'r1', kind: 'action_red', text: 'Ring vårdkontakten', order: 0, approvedAt: '2026-01-01' },
    { id: 'y1', kind: 'action_yellow', text: 'Vila', order: 0, approvedAt: '2026-01-01' },
  ];
  const serious = { kind: 'serious_sign' as const, points: 2, label: 'Slutar äta', measured: false };

  it('gives the red actions, whatever the level, and changes neither level nor points', () => {
    expect(seriousActions({ signals: [serious] }, plan)?.map((p) => p.id)).toEqual(['r1']);
  });

  it('gives an empty list when the plan has no actions at red, so the screen can say so', () => {
    expect(seriousActions({ signals: [serious] }, plan.filter((p) => p.kind !== 'action_red'))).toEqual([]);
  });

  it('gives nothing without a serious sign, or when the emergency rule has its own card', () => {
    expect(seriousActions({ signals: [{ ...serious, kind: 'early_sign', points: 1 }] }, plan)).toBeNull();
    expect(seriousActions({ signals: [serious], akut: true }, plan)).toBeNull();
  });
});

describe('green text and trend lines', () => {
  const PS = { normalState: '', sleepThresholdHours: 5 };
  const day = (date: string, over: Partial<Entry> = {}): Entry => ({
    id: `t_${date}`, date, createdAt: `${date}T21:00:00`, kind: 'checkin', transcript: 'Vanlig dag.',
    mood: 0, energy: 5, wordsPerMinute: null, sleepHours: 7.5, sleepSource: 'garmin', stressAvg: 30, ...over,
  });
  const calm = (last: string, n: number) => Array.from({ length: n }, (_, i) => ({ entry: day(addDays(last, -i)), level: 'green' as const }));
  const T = '2026-11-04';

  it('green always says "Inget av dina tecken syntes i dag.", whatever the model wrote', async () => {
    const chatty: SignMatcher = { async match() { return { matches: [], sentence: 'Allt ser bra ut i dag!', method: 'llm', model: 'm', promptId: 'analys', promptVersion: '1.2.0' }; } };
    const a = await assessEntry({ entry: day(T), plan: [], planSettings: PS, history: calm(addDays(T, -1), 10), matcher: chatty });
    expect(a.level).toBe('green');
    expect(a.sentence).toBe('Inget av dina tecken syntes i dag.');
    expect(displaySentence({ level: 'green', sentence: 'Inget i anteckningen avviker från ditt normalläge.' })).toBe('Inget av dina tecken syntes i dag.');
  });

  it('three nights 6,5, 6,0 and 5,5 h give green with the sleep line and no points', async () => {
    const history = [...calm(addDays(T, -3), 10), { entry: day(addDays(T, -2), { sleepHours: 6.5 }), level: 'green' as const }, { entry: day(addDays(T, -1), { sleepHours: 6 }), level: 'green' as const }];
    const a = await assessEntry({ entry: day(T, { sleepHours: 5.5 }), plan: [], planSettings: PS, history, matcher: wordMatcher });
    expect([a.level, a.points, a.trend]).toEqual(['green', 0, ['Din sömn har blivit kortare tre nätter i rad.']]);
  });

  it('no line when one of the nights is missing, not shorter each night, or under the limit (then it scores instead)', () => {
    const base = calm(addDays(T, -3), 10);
    const bl = { wordsPerMinute: null, stressAvg: 30, greenDays: 10, sleepHours: 7.5, entryTime: null, weekOf: '2026-11-02' };
    const h = (a: number, b: number) => [...base, { entry: day(addDays(T, -2), { sleepHours: a }), level: 'green' as const }, { entry: day(addDays(T, -1), { sleepHours: b }), level: 'green' as const }];
    expect(trendLines(day(T, { sleepHours: 5.5 }), h(6.5, 6.5), {}, PS, bl)).toEqual([]);
    expect(trendLines(day(T, { sleepHours: 4.5 }), h(6.5, 6), {}, PS, bl)).toEqual([]);
    expect(trendLines(day(T, { sleepHours: 5.5 }), base, {}, PS, bl)).toEqual([]);
  });

  it('stress rising three days but within 1,3 times the usual gives the stress line', () => {
    const bl = { wordsPerMinute: null, stressAvg: 30, greenDays: 10, sleepHours: 7.5, entryTime: null, weekOf: '2026-11-02' };
    const history = [{ entry: day(addDays(T, -2), { stressAvg: 31 }), level: 'green' as const }, { entry: day(addDays(T, -1), { stressAvg: 34 }), level: 'green' as const }];
    expect(trendLines(day(T, { stressAvg: 38 }), history, {}, PS, bl)).toEqual(['Din stress har ökat tre dagar i rad.']);
    expect(trendLines(day(T, { stressAvg: 40 }), history, {}, PS, bl)).toEqual([]);
  });

  it('the trend line is kept off yellow and red days', async () => {
    const history = [...calm(addDays(T, -3), 10), { entry: day(addDays(T, -2), { sleepHours: 6.5 }), level: 'green' as const }, { entry: day(addDays(T, -1), { sleepHours: 6 }), level: 'green' as const }];
    const a = await assessEntry({ entry: { ...day(T, { sleepHours: 5.5 }), kind: 'heavy', transcript: '' }, plan: [], planSettings: PS, history, matcher: wordMatcher });
    expect(a.level).toBe('yellow');
    expect(a.trend).toBeUndefined();
  });
});

describe('the Trend tab\'s days', () => {
  it('gives one row per day, oldest first, Garmin before the entry, and counts levels and missing days', () => {
    const e = (date: string, sleepHours: number | null, stressAvg: number | null): Entry => ({
      id: `t_${date}`, date, createdAt: `${date}T21:00:00`, kind: 'checkin', transcript: '', mood: 0, energy: 5,
      wordsPerMinute: null, sleepHours, sleepSource: 'transcript', stressAvg,
    });
    const entries = [e('2026-10-30', 6, null), e('2026-11-01', 7, 30)];
    const assessments = [
      { entryId: 't_2026-10-30', level: 'yellow' }, { entryId: 't_2026-11-01', level: 'green' },
    ] as never[];
    const garmin = { '2026-10-30': { date: '2026-10-30', sleepHours: 5.5, stressAvg: 41 } } as never;
    const t = buildTrend(entries, assessments, garmin, '2026-11-01', 3);
    expect(t.days).toEqual([
      { date: '2026-10-30', level: 'yellow', sleepHours: 5.5, stressAvg: 41 },
      { date: '2026-10-31', level: null, sleepHours: null, stressAvg: null },
      { date: '2026-11-01', level: 'green', sleepHours: 7, stressAvg: 30 },
    ]);
    expect(t.counts).toEqual({ green: 1, yellow: 1, red: 0 });
    expect(t.missing).toBe(1);
  });
});
