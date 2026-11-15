// Mina mönster: the analysis on invented data. The code finds the links and counts; a model may
// only word a verified result, and its wording is checked.
import { addDays } from '../src/core/analysis/dates';
import {
  analysePatterns, binomialTail, CANDIDATES, checkExplanation, findingEvidence, findingFacts, findingSummary, findingTitle, followUp, hypothesisOf,
  findingTopic, insufficientLine, methodText, moodPeriods, PATTERN_PARAMS, relatedLine, statusLine, type PatternData,
} from '../src/core/analysis/moodPatterns';
import { simulate, simulateRatings, type SimEvent } from '../src/core/analysis/rhythmSim';

const END = '2026-11-13';
const d = (n: number) => addDays(END, -n);

function world(events: SimEvent[], opts: { days?: number; seed?: number; skip?: number; documented?: boolean } = {}): PatternData {
  const days = opts.days ?? 400;
  const data = simulate({ end: END, days, seed: opts.seed ?? 5, events });
  return { ...data, episodes: opts.documented ? data.episodes : [], ratings: simulateRatings({ end: END, days, seed: opts.seed ?? 5, events, skip: opts.skip }) };
}

const up = (n: number, extra: Partial<Extract<SimEvent, { kind: 'episode' }>> = {}): SimEvent => ({ kind: 'episode', start: d(n), type: 'up', days: 14, ...extra });
const down = (n: number): SimEvent => ({ kind: 'episode', start: d(n), type: 'down', days: 14 });

describe('periods of rated mood', () => {
  it('needs two rated days or one strong day, and a day rated otherwise ends it', () => {
    const r = { '2026-01-01': 0, '2026-01-02': 1, '2026-01-03': 1, '2026-01-04': 0, '2026-01-20': 1, '2026-01-21': 0, '2026-02-01': 0, '2026-02-02': 2 };
    const p = moodPeriods(r, '2026-01-01', '2026-03-01');
    expect(p.map((x) => [x.direction, x.start, x.end])).toEqual([['up', '2026-01-02', '2026-01-03'], ['up', '2026-02-02', '2026-02-02']]);
  });

  it('a missing day is not a rating: a gap ends a period, and a start without a rating before it is unknown', () => {
    const r = { '2026-01-10': -1, '2026-01-11': -2, '2026-01-20': -1, '2026-01-21': -1 };
    const p = moodPeriods(r, '2026-01-01', '2026-03-01');
    expect(p).toHaveLength(2);
    expect(p.every((x) => x.direction === 'down' && !x.startKnown)).toBe(true);
  });

  it('two runs a few days apart are one period', () => {
    const r = { '2026-01-01': 0, '2026-01-02': 1, '2026-01-03': 2, '2026-01-04': 0, '2026-01-06': 1, '2026-01-07': 1 };
    const p = moodPeriods(r, '2026-01-01', '2026-03-01');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ start: '2026-01-02', end: '2026-01-07', ratedDays: 4, peak: 2, startKnown: true });
  });
});

describe('the analysis', () => {
  it('finds shorter and later sleep before higher rated mood when it recurs before three separate periods', () => {
    const a = analysePatterns(world([up(330), up(240), up(150), up(60)]), END, 'x');
    expect(a.status).toBe('found');
    expect(a.findings.length).toBeGreaterThanOrEqual(1);
    expect(a.findings.length).toBeLessThanOrEqual(PATTERN_PARAMS.maxFindings);
    const f = a.results.find((x) => x.candidate.id === 'shorter_up')!;
    expect(f.qualifies).toBe(true);
    expect(f.hits).toBe(4);
    expect(f.timing).toBe('before');
    expect(f.leadDays.every((l) => l >= 1 && l <= 7)).toBe(true);
    expect(findingTitle(f)).toBe('Kortare sömn före högre stämningsläge');
    expect(findingSummary(f)).toMatch(/^Mönstret återkom före alla fyra separata perioder då du skattade högre stämningsläge\./);
    expect(statusLine(a)).toMatch(/återkommande mönster hittades\.$/);
  });

  it('says "men inte varje gång" and lists the period without the pattern as a counterexample', () => {
    // Four periods; before one of them the sleep did not change (no run-up nights).
    const a = analysePatterns(world([up(330), up(240), up(150, { leadNights: 0 }), up(60)]), END, 'x');
    const f = a.results.find((x) => x.candidate.id === 'shorter_up')!;
    // The period without a run-up still gets short sleep from its first night, so it counts as "with", not as a miss …
    expect(f.periods).toHaveLength(4);
    // … so make a real miss: ratings go up while the watch shows nothing.
    const w = world([up(330), up(240), up(60)]);
    for (let i = 150; i > 140; i--) w.ratings[d(i)] = i === 150 ? 1 : 2;
    const b = analysePatterns(w, END, 'x');
    const g = b.results.find((x) => x.candidate.id === 'shorter_up')!;
    expect(g.periods).toHaveLength(4);
    expect(g.hits).toBe(3);
    expect(g.qualifies).toBe(true);
    expect(findingSummary(g)).toBe('Mönstret återkom före tre av fyra separata perioder då du skattade högre stämningsläge, men inte varje gång.');
    const e = findingEvidence(g, b);
    expect(e.periods).toHaveLength(3);
    expect(e.counterexamples.some((l) => /utan kortare sömn före/.test(l))).toBe(true);
    expect(e.missing[e.missing.length - 1]).toMatch(/^Underlaget är 400 dagar/);
  });

  it('a pattern that also comes in calm times is a counterexample, and too many of them is no finding', () => {
    const lateWeeks: SimEvent[] = [310, 290, 270, 215, 195, 175, 125, 105, 85, 65, 45, 25].map((n) => ({ kind: 'late_week', from: d(n), nights: 5 }));
    const a = analysePatterns(world([up(330), up(240), up(150), ...lateWeeks]), END, 'x');
    const f = a.results.find((x) => x.candidate.id === 'shorter_up')!;
    expect(f.hits).toBe(3);
    expect(f.patternOnly.length).toBeGreaterThanOrEqual(5);
    expect(f.calmRate).toBeGreaterThan(0.2);
    expect(f.qualifies).toBe(false);
  });

  it('answers "Inget tydligt samband hittades." when there are periods but the watch shows nothing before them', () => {
    const w = world([]);
    for (const start of [330, 240, 150, 60]) for (let i = 0; i < 10; i++) w.ratings[d(start - i)] = i === 0 ? 1 : 2;
    const a = analysePatterns(w, END, 'x');
    expect(a.status).toBe('none');
    expect(a.findings).toEqual([]);
    expect(statusLine(a)).toBe('Inget tydligt samband hittades.');
  });

  it('answers "För lite data …" with the reason: too few periods, ratings or nights', () => {
    const few = analysePatterns(world([up(240), up(60)]), END, 'x');
    expect(few.status).toBe('insufficient');
    expect(few.insufficient).toBe('periods');
    expect(statusLine(few)).toBe('För lite data för att hitta återkommande mönster.');
    expect(insufficientLine(few)).toMatch(/minst tre perioder .* Det finns två med högre och noll med lägre\./);

    const noRatings = world([up(330), up(240), up(150)]);
    noRatings.ratings = Object.fromEntries(Object.entries(noRatings.ratings).slice(0, 10));
    expect(analysePatterns(noRatings, END, 'x').insufficient).toBe('ratings');

    const noNights = world([up(20)], { days: 25 });
    expect(analysePatterns(noNights, END, 'x').insufficient).toBe('nights');
  });

  it('a period the watch could not judge is missing data, not a counterexample', () => {
    const a = analysePatterns(world([up(330), up(240), up(150), up(60), { kind: 'not_worn', from: d(162), days: 16 }]), END, 'x');
    const f = a.results.find((x) => x.candidate.id === 'shorter_up')!;
    expect(f.periodsUnjudged).toBe(1);
    expect(f.periods).toHaveLength(3);
    expect(findingEvidence(f, a).missing[0]).toMatch(/^En period gick inte att bedöma/);
  });

  it('finds longer sleep before lower rated mood, and keeps the directions apart', () => {
    const a = analysePatterns(world([down(330), down(240), down(150), down(60)]), END, 'x');
    expect(a.findings.map((x) => x.candidate.id)).toContain('longer_down');
    expect(a.findings.every((x) => x.candidate.mood === 'down')).toBe(true);
  });

  it('tries only the links decided beforehand, and shows at most two', () => {
    const a = analysePatterns(world([up(330), up(240), up(150), up(60)]), END, 'x');
    expect(a.tested).toBe(CANDIDATES.length);
    expect(CANDIDATES.length).toBeLessThanOrEqual(6);
    expect(a.results.map((r) => r.candidate.id)).toEqual(CANDIDATES.map((c) => c.id));
    expect(a.findings.length).toBeLessThanOrEqual(2);
    expect(methodText(a)).toContain('inte bekräftade episoder');
    // Later sleep, shorter sleep and a later pulse before the same periods are one finding, with the others named.
    expect(a.results.filter((r) => r.qualifies).length).toBeGreaterThan(1);
    expect(a.findings).toHaveLength(1);
    expect(relatedLine(a.findings[0], a)).toMatch(/^Även .* kom före samma slags perioder\./);
  });

  it('never uses a day without a rating as a rating of zero', () => {
    const w = world([up(330), up(240), up(150), up(60)], { skip: 0.6 });
    const a = analysePatterns(w, END, 'x');
    expect(a.coverage.ratedDays).toBe(Object.keys(w.ratings).length);
    expect(a.coverage.ratedDays).toBeLessThan(a.coverage.days * 0.6);
  });
});

describe('the short card on Hem', () => {
  it('names only what the finding is about, without direction, timing or numbers', () => {
    const t = (pattern: (typeof CANDIDATES)[number]['pattern']) => findingTopic({ candidate: { id: 'x', pattern, mood: 'up' } });
    expect(t('shorter')).toBe('Sömn och stämningsläge');
    expect(t('later')).toBe('Sömn och stämningsläge');
    expect(t('longer')).toBe('Sömn och stämningsläge');
    expect(t('evening_activity')).toBe('Kvällspuls och stämningsläge');
    for (const c of CANDIDATES) expect(findingTopic({ candidate: c })).not.toMatch(/före|efter|\d/);
  });
});

describe('a finding is a hypothesis, tried on later data', () => {
  it('counts only periods that started after the day it was found', () => {
    const events = [up(330), up(240), up(150), up(60)];
    const w = world(events);
    const early: PatternData = { ...w, measured: Object.fromEntries(Object.entries(w.measured).filter(([k]) => k <= d(100))), activity: Object.fromEntries(Object.entries(w.activity).filter(([k]) => k <= d(100))), ratings: Object.fromEntries(Object.entries(w.ratings).filter(([k]) => k <= d(100))) };
    const first = analysePatterns(early, d(100), 'x');
    const f = first.results.find((x) => x.candidate.id === 'shorter_up')!;
    expect(f.hits).toBe(3);
    const h = hypothesisOf(f, first);
    expect(h).toMatchObject({ candidateId: 'shorter_up', dataThrough: d(100), found: { periods: 3, hits: 3 } });
    expect(followUp(h, first)).toEqual({ periods: 0, hits: 0, patternOnly: 0 });
    const later = analysePatterns(w, END, 'y');
    expect(followUp(h, later)).toMatchObject({ periods: 1, hits: 1 });
  });
});

describe('the language model only words a verified result', () => {
  const a = analysePatterns(world([up(330), up(240), up(150), up(60)]), END, 'x');
  const f = a.results.find((x) => x.candidate.id === 'shorter_up')!;
  const facts = findingFacts(f, a);

  it('gets only counts: no dates and nothing the person wrote', () => {
    expect(facts).toContain('Perioder som gick att bedöma: 4.');
    expect(facts).toContain('Perioder där mönstret fanns före starten: 4.');
    expect(facts).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(facts).not.toMatch(/januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december/);
  });

  it('accepts a short wording that uses only the numbers given', () => {
    expect(checkExplanation({ text: 'Fyra gånger skattade du högre stämningsläge, och alla 4 gångerna hade sömnen blivit kortare dagarna innan.' }, facts)).toMatch(/^Fyra gånger/);
  });

  it('rejects a number that is not among the facts, as digits or as a word', () => {
    expect(checkExplanation({ text: 'Det hände 9 gånger.' }, facts)).toBeNull();
    expect(checkExplanation({ text: 'Det hände nio gånger.' }, facts)).toBeNull();
    expect(checkExplanation({ text: 'I 80 procent av fallen kom kortare sömn före.' }, facts)).toBeNull();
  });

  it('rejects diagnoses, causes, forecasts and advice, but not ordinary words that begin the same way', () => {
    for (const t of ['Kortare sömn kom före dina maniska episoder.', 'Kort sömn orsakar högre stämningsläge.', 'Det här förutsäger nästa period.', 'Du bör sova mer.', 'Det är en risk.']) {
      expect(checkExplanation({ text: t }, facts)).toBeNull();
    }
    expect(checkExplanation({ text: 'Sömnen började bli kortare dagarna innan du skattade högre.' }, facts)).not.toBeNull();
  });

  it('rejects an empty, too long or malformed answer', () => {
    expect(checkExplanation({ text: '' }, facts)).toBeNull();
    expect(checkExplanation({ text: 'a'.repeat(401) }, facts)).toBeNull();
    expect(checkExplanation({ wrong: 'x' }, facts)).toBeNull();
    expect(checkExplanation(null, facts)).toBeNull();
  });
});

describe('the chance of a result', () => {
  it('is the binomial tail', () => {
    expect(binomialTail(3, 3, 0.1)).toBeCloseTo(0.001, 6);
    expect(binomialTail(5, 3, 0.1)).toBeCloseTo(0.00856, 5);
    expect(binomialTail(4, 0, 0.3)).toBe(1);
    expect(binomialTail(3, 3, 0)).toBe(0);
  });
});
