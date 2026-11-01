import { assessEntry, wordMatcher, templateSentence, NOTHING_STANDS_OUT, firstStep } from '../src/analysis/assess';
import { addDays, eveningDateKey } from '../src/analysis/dates';
import { computeBaseline, levelFromSignals, score, silentDaysBefore, silentDaysUntil } from '../src/analysis/scoring';
import { loadTestSuite } from '../src/analysis/testcases';
import { matchSigns } from '../src/analysis/wordmatch';
import type { Entry, PlanItem } from '../src/domain/types';

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
    mood: 5, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null,
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
    const r = score({ entry: entry({ date: '2026-10-20', mood: 9, energy: 9 }), matches: [], plan, planSettings: ps, history: greenWeek });
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

  it('entries before 05:00 belong to the previous evening', () => {
    expect(eveningDateKey(new Date(2026, 9, 21, 1, 15))).toBe('2026-10-20');
    expect(eveningDateKey(new Date(2026, 9, 21, 5, 0))).toBe('2026-10-21');
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
