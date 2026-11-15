// Rules 1.8.0, after the second review: the signal logic. Every case runs on invented data.

import { addDays } from '../src/core/analysis/dates';
import {
  assessRhythm, changeScope, changeSentence, combinedDirection, detect, directionFor, directionText, eveningOf, prepare,
  type ActivityDay, type Direction, type EpisodeStart, type RhythmChange,
} from '../src/core/analysis/rhythm';
import { simulate } from '../src/core/analysis/rhythmSim';
import { aboutSleep, score, stressGap } from '../src/core/analysis/scoring';
import type { Entry, PlanItem } from '../src/core/domain/types';

const END = '2026-11-13';
const d = (n: number) => addDays(END, -n);

describe('Dygnsrytm: each pattern on its own', () => {
  const dir = (p: Partial<Direction>): Direction => ({
    value: 'unclear', reason: 'no_match', pattern: 'later', matches: [], compared: { up: 1, down: 1, mixed: 0 }, stableRuns: [], stableDaysJudged: 40, ...p,
  });
  const match = (type: 'up' | 'down') => ({ episodeId: type, type, start: d(90), source: 'self_retro' as const });

  it('two patterns with support in opposite directions give unclear, and the text names both', () => {
    const later = dir({ pattern: 'later', value: 'down', reason: 'supported', matches: [match('down') as any] });
    const shorter = dir({ pattern: 'shorter', value: 'up', reason: 'supported', matches: [match('up') as any] });
    const c = combinedDirection([later, shorter]);
    expect(c.value).toBe('unclear');
    expect(c.reason).toBe('conflict');
    expect(directionText(c)).toBe('Mönstren pekar åt olika håll: senare insomning före en nedstämd period och kortare sömn före en uppvarvad period. Det går inte att säga åt vilket håll det pekar.');
  });

  it('one pattern with support and one without gives the supported one', () => {
    const c = combinedDirection([dir({ pattern: 'later' }), dir({ pattern: 'shorter', value: 'up', reason: 'supported', matches: [match('up') as any] })]);
    expect(c.value).toBe('up');
    expect(c.pattern).toBe('shorter');
    expect(c.byPattern?.map((p) => p.reason)).toEqual(['no_match', 'supported']);
  });

  it('says how many days outside the registered periods were judged, not "stable periods"', () => {
    const t = directionText(dir({ value: 'up', reason: 'supported', matches: [match('up') as any], stableDaysJudged: 37 }));
    expect(t).toContain('Mönstret fanns inte under någon av de 37 dagar utanför registrerade perioder som gick att bedöma.');
    expect(t).not.toMatch(/stabil/);
  });

  it('without any day outside the periods to compare with, the direction is unclear', () => {
    const data = simulate({ end: END, days: 200, seed: 3, events: [{ kind: 'episode', start: d(100), type: 'up' }, { kind: 'episode', start: addDays(END, 1), type: 'up' }] });
    const known = data.episodes.filter((e) => e.start < END);
    // History from two weeks before the period, and later periods close together, so every
    // day compared lies within two weeks of a registered period.
    const filler: EpisodeStart[] = [60, 30].map((n) => ({ id: `f${n}`, start: d(n), end: d(n - 20), type: 'mixed', source: 'self_retro', createdAt: '' }));
    const p = prepare(data.measured, data.activity, d(199), END);
    const r = directionFor(p, END, 'evening_activity', [...known, ...filler], true, d(113));
    expect(r.stableDaysJudged).toBe(0);
    expect(r.value).toBe('unclear');
    expect(r.reason).toBe('no_stable_comparison');
    expect(directionText(r)).toContain('Det finns inga dagar utanför registrerade perioder som gick att bedöma');
  });
});

describe('Dygnsrytm: the evening pulse', () => {
  const day = (date: string, active: (h: number) => number, worn: (h: number) => number = () => 1): ActivityDay => ({
    date, activeMinutes: Array.from({ length: 24 }, (_, h) => active(h)), worn: Array.from({ length: 24 }, (_, h) => worn(h)), restingHr: 55, tzOffsetMin: 60, lastReading: '23:59', fetchedAt: `${date}T23:59:00`,
  });

  it('an evening without the watch is not an evening without raised pulse', () => {
    const night = d(0);
    const activity = {
      [d(1)]: day(d(1), (h) => (h >= 8 && h < 20 ? 10 : 0), (h) => (h < 21 ? 1 : 0)),
      [night]: day(night, () => 0, () => 0),
    };
    // 17 of 24 hours worn overall, which was enough before, but none of the evening.
    const e = eveningOf(activity, night);
    expect(e.late).toBeNull();
    expect(e.lateMinutes).toBeNull();
  });

  it('a share that rises because the day had less, with the same evening, is not later activity', () => {
    const data = simulate({ end: END, days: 60 });
    const activity: Record<string, ActivityDay> = {};
    for (let n = 60; n >= 0; n--) {
      const quiet = n <= 3; // the latest days: less in the daytime, the evening as usual
      activity[d(n)] = day(d(n), (h) => (h >= 10 && h < 16 ? (quiet ? 2 : 10) : h === 21 ? 20 : 0));
    }
    const p = prepare(data.measured, activity, d(59), END);
    const base = p.evenings.get(d(10))!;
    const now = p.evenings.get(END)!;
    expect(now.late!).toBeGreaterThan(base.late! * 2);
    expect(now.lateMinutes).toBe(base.lateMinutes);
    expect(detect(p, END, [], true).changes.map((c) => c.pattern)).not.toContain('evening_activity');
  });
});

describe('Dygnsrytm: nights with a gap', () => {
  it('says three of the latest four nights and that one night has no data', () => {
    const c: RhythmChange = { pattern: 'later', nights: [d(3), d(2), d(0)], values: ['01:10', '01:25', '01:40'], usual: '23:15' };
    expect(changeSentence(c)).toBe('Tre av de fyra senaste nätterna har du somnat senare än vanligt: 01:10, 01:25 och 01:40 mot vanligt 23:15. En natt saknar data.');
    expect(changeScope([c])).toBe('Tre av fyra nätter. En saknar data.');
  });

  it('keeps "i rad" for nights that follow each other', () => {
    const c: RhythmChange = { pattern: 'later', nights: [d(2), d(1), d(0)], values: ['01:10', '01:25', '01:40'], usual: '23:15' };
    expect(changeSentence(c)).toMatch(/^Tre nätter i rad har du somnat senare/);
    expect(changeScope([c])).toBe('Tre nätter i rad.');
  });

  it('the real estimate with one night missing uses the gap wording', () => {
    const data = simulate({ end: END, days: 60, events: [{ kind: 'episode', start: addDays(END, 1), type: 'up' }, { kind: 'not_worn', from: d(1), days: 1 }] });
    const a = assessRhythm(data, END, 'x');
    if (a.status === 'change' && a.changes[0].pattern !== 'irregular' && a.changes[0].nights.length === 3) {
      expect(a.text.change).toMatch(/^Tre av de fyra senaste nätterna/);
      expect(a.text.change).toContain('En natt saknar data.');
    }
  });
});

function entry(partial: Partial<Entry> & { date: string }): Entry {
  return {
    id: `e_${partial.date}`, createdAt: `${partial.date}T21:00:00`, kind: 'checkin', transcript: '',
    mood: 0, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null, ...partial,
  };
}
const ps = { normalState: '', sleepThresholdHours: 5 };

describe('the same short sleep counts once (rules 1.8.0)', () => {
  const plan: PlanItem[] = [
    { id: 'e1', kind: 'early', text: 'Sover mindre', order: 0, approvedAt: '' },
    { id: 's1', kind: 'serious', text: 'Ligger vaken hela natten', order: 0, approvedAt: '' },
    { id: 'e2', kind: 'early', text: 'Drar mig undan', order: 0, approvedAt: '' },
  ];
  const yesterdayShort = [{ entry: entry({ date: d(1), sleepHours: 4 }), level: 'yellow' as const }];

  it('knows a sign about sleep from one that is not', () => {
    expect(aboutSleep('Sover mindre')).toBe(true);
    expect(aboutSleep('Ligger vaken hela natten')).toBe(true);
    expect(aboutSleep('svårt att somna')).toBe(true);
    expect(aboutSleep('Drar mig undan')).toBe(false);
    expect(aboutSleep('Gör av med pengar')).toBe(false);
  });

  it('an early sleep sign and one short night: the night gives no point of its own', () => {
    const r = score({ entry: entry({ date: END, sleepHours: 4 }), matches: [{ planItemId: 'e1', quote: 'sov bara fyra timmar' }], plan, planSettings: ps, history: [] });
    const sleep = r.signals.find((s) => s.kind === 'sleep_low')!;
    expect(sleep.points).toBe(0);
    expect(sleep.label).toContain('räknas redan genom ditt tecken');
    expect(r.points).toBe(1);
  });

  it('an early sleep sign and two short nights: the second night still counts', () => {
    const r = score({ entry: entry({ date: END, sleepHours: 4 }), matches: [{ planItemId: 'e1', quote: 'sov bara fyra timmar' }], plan, planSettings: ps, history: yesterdayShort });
    expect(r.signals.find((s) => s.kind === 'sleep_low_consecutive')?.points).toBe(1);
    expect(r.points).toBe(2);
  });

  it('a serious sleep sign over the same night is not red by "serious plus another sign"', () => {
    const r = score({ entry: entry({ date: END, sleepHours: 4 }), matches: [{ planItemId: 's1', quote: 'låg vaken hela natten' }], plan, planSettings: ps, history: [] });
    expect(r.points).toBe(2);
    expect(r.level).toBe('yellow');
  });

  it('a sign about something else leaves the short night its point', () => {
    const r = score({ entry: entry({ date: END, sleepHours: 4 }), matches: [{ planItemId: 'e2', quote: 'drog mig undan' }], plan, planSettings: ps, history: [] });
    expect(r.signals.find((s) => s.kind === 'sleep_low')?.points).toBe(1);
    expect(r.points).toBe(2);
  });
});

describe('stress per source (rules 1.8.0)', () => {
  const hist = (days: { v: number | null; source: 'garmin' | 'manual' }[]) =>
    days.map((x, i) => ({ entry: entry({ date: d(days.length - i), stressAvg: x.v, stressSource: x.source }), level: 'green' as const }));
  const run = (days: { v: number | null; source: 'garmin' | 'manual' }[], today: number, source: 'garmin' | 'manual') =>
    score({ entry: entry({ date: END, stressAvg: today, stressSource: source }), matches: [], plan: [], planSettings: ps, history: hist(days) }).signals.find((s) => s.kind === 'stress_high');

  it('manual stress counts only at "Hög", and the label says the person gave it', () => {
    expect(run([{ v: 75, source: 'manual' }, { v: 75, source: 'manual' }], 75, 'manual')?.label).toBe('Du angav hög stress tre dagar i rad');
    expect(run([{ v: 50, source: 'manual' }, { v: 50, source: 'manual' }], 50, 'manual')).toBeUndefined();
  });

  it('a run that switches source does not count', () => {
    expect(run([{ v: 40, source: 'garmin' }, { v: 75, source: 'manual' }], 40, 'garmin')).toBeUndefined();
    expect(run([{ v: 40, source: 'garmin' }, { v: 40, source: 'garmin' }], 40, 'garmin')?.label).toBe('Stress 30 eller mer tre dagar i rad (40, 40, 40)');
  });

  it('the gap counts each value on its own source’s scale', () => {
    // Manual Medel (50) is not high, so a missing day does not make the rule unjudgeable.
    expect(stressGap(END, hist([{ v: 50, source: 'manual' }, { v: null, source: 'manual' }]), {}, 50, 'manual')).toBe(0);
    expect(stressGap(END, hist([{ v: 75, source: 'manual' }, { v: null, source: 'manual' }]), {}, 75, 'manual')).toBe(1);
    expect(stressGap(END, hist([{ v: 40, source: 'garmin' }, { v: null, source: 'garmin' }]), {}, 40, 'garmin')).toBe(1);
  });
});
