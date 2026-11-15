// Dygnsrytm (experimental): the passive model's rules, on invented watch data. Every case
// here is simulated; none of it says how the model works for a real person.

import { assessRhythm, axis, changeHeadline, changeScope, clockOfAxis, detect, directionFor, directionHeadline, nightsFrom, prepare, type EpisodeStart, type RhythmChange, type RhythmData } from '../src/core/analysis/rhythm';
import { dailyCalls, evaluateRhythm, evaluationReport } from '../src/core/analysis/rhythmEval';
import { simulate, simulatedYear } from '../src/core/analysis/rhythmSim';
import { addDays } from '../src/core/analysis/dates';
import { levelFromSignals, rhythmSignalFor, score } from '../src/core/analysis/scoring';
import { recomputeHistory } from '../src/core/analysis/recompute';
import { parseHeartRate, parseSleep, tzOffsetOf } from '../src/garmin/client';
import type { Assessment, Entry, PlanItem, RhythmScoreInput } from '../src/core/domain/types';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import {
  ACTIVITY_KEY, activityDaysToFetch, explainCourse, markRhythmSeen, rhythmCard, rhythmScoreInput, saveEpisode, updateRhythm,
} from '../src/services/rhythm';

const END = '2026-11-13';
const d = (n: number) => addDays(END, -n);

describe('features from the watch', () => {
  it('puts the night on an axis without a jump at midnight', () => {
    expect(axis('23:15')).toBe(315);
    expect(axis('01:40')).toBe(460);
    expect(clockOfAxis(axis('02:05'))).toBe('02:05');
  });

  it('reads the time zone of a night and of a heart-rate day from Garmin\u2019s paired timestamps', () => {
    expect(tzOffsetOf(Date.UTC(2026, 10, 1, 23, 0), Date.UTC(2026, 10, 1, 22, 0))).toBe(60);
    const [n] = parseSleep([{ dailySleepDTO: { calendarDate: '2026-11-02', sleepTimeSeconds: 25000, sleepStartTimestampLocal: Date.UTC(2026, 10, 1, 23, 10), sleepStartTimestampGMT: Date.UTC(2026, 10, 1, 22, 10), sleepEndTimestampLocal: Date.UTC(2026, 10, 2, 6, 10), sleepEndTimestampGMT: Date.UTC(2026, 10, 2, 5, 10) } }]);
    expect(n.tzOffsetMin).toBe(60);
  });

  it('reduces the day\u2019s heart rate to active minutes per hour and keeps no readings', () => {
    const start = Date.UTC(2026, 10, 12, 23, 0); // 00:00 local at +60
    const values: [number, number | null][] = [];
    for (let i = 0; i < 720; i++) {
      const hourLocal = Math.floor(i / 30);
      values.push([start + i * 120_000, hourLocal === 22 ? 110 : hourLocal === 3 ? null : 60]);
    }
    const day = parseHeartRate({ startTimestampGMT: '2026-11-12T23:00:00.0', startTimestampLocal: '2026-11-13T00:00:00.0', restingHeartRate: 58, heartRateValues: values }, '2026-11-13')!;
    expect(day.tzOffsetMin).toBe(60);
    expect(day.activeMinutes[22]).toBe(60);
    expect(day.activeMinutes[12]).toBe(0);
    expect(day.activeMinutes[3]).toBeNull();
    expect(day.worn[3]).toBe(0);
    expect(JSON.stringify(day)).not.toContain('110');
  });

  it('leaves out day sleep and the first nights after a change of time zone', () => {
    const data = simulate({ end: END, days: 20, events: [{ kind: 'timezone', from: d(5), offsetMin: 180 }] });
    const nights = nightsFrom(data.measured, d(19), END);
    expect(nights.filter((n) => n.excluded === 'timezone').map((n) => n.date)).toEqual([d(5), d(4), d(3)]);
  });
});

describe('what changed', () => {
  it('a week without any check-in can give an understandable warning when the watch data are enough (acceptance)', () => {
    const data = simulate({ end: END, days: 60, events: [{ kind: 'episode', start: addDays(END, 1), type: 'up' }] });
    const a = assessRhythm(data, END, `${END}T07:00:00.000Z`);
    expect(a.status).toBe('change');
    expect(a.changes.map((c) => c.pattern)).toContain('later');
    expect(a.text.change).toMatch(/^Tre nätter i rad har du somnat senare än vanligt: \d\d:\d\d, \d\d:\d\d och \d\d:\d\d mot vanligt 23:\d\d\./);
    expect(a.text.change).toContain('Även den förhöjda pulsen har flyttats mot kvällen.');
    expect(a.covers).toEqual({ from: d(2), to: END });
    expect(a.text.direction).toBe('Det finns inga tidigare perioder inlagda att jämföra med.');
  });

  it('says clearly that the data are too few when the watch was not worn (acceptance)', () => {
    const data = simulate({ end: END, days: 60, events: [{ kind: 'not_worn', from: d(3), days: 4 }] });
    const a = assessRhythm(data, END, 'x');
    expect(a.status).toBe('insufficient');
    expect(a.insufficient).toEqual({ reason: 'recent', have: 0, need: 3 });
    expect(a.text.change).toBe('För lite data. Klockan har sömn för 0 av de 4 senaste nätterna. Har klockan inte burits, eller inte synkat?');
    expect(a.direction).toBeNull();
  });

  it('says too little data before there are 14 nights to compare with', () => {
    const a = assessRhythm(simulate({ end: END, days: 15 }), END, 'x');
    expect(a.status).toBe('insufficient');
    expect(a.insufficient?.reason).toBe('baseline');
    expect(a.text.change).toMatch(/minst 14 nätter från klockan att jämföra med och har \d+\./);
  });

  it('one missing night of the latest four is skipped, two are too many', () => {
    const one = simulate({ end: END, days: 60, events: [{ kind: 'not_worn', from: d(1), days: 1 }] });
    expect(assessRhythm(one, END, 'x').status).toBe('stable');
    const two = simulate({ end: END, days: 60, events: [{ kind: 'not_worn', from: d(2), days: 2 }] });
    expect(assessRhythm(two, END, 'x').status).toBe('insufficient');
  });

  it('a single short night is not a change', () => {
    const data = simulate({ end: END, days: 60, events: [{ kind: 'short_night', date: d(1), hours: 3.8 }] });
    const a = assessRhythm(data, END, 'x');
    expect(a.status).toBe('stable');
    expect(a.singleShort?.night).toBe(d(1));
    expect(a.text.change).toContain('En natt var kort (3,8 timmar), men det är en enstaka natt, inte en förändring.');
  });

  it('tells a gradual shift with later activity from one with sleep only', () => {
    const data = simulate({ end: END, days: 60, events: [{ kind: 'episode', start: addDays(END, 1), type: 'up' }] });
    const p = prepare(data.measured, data.activity, d(59), END);
    expect(detect(p, END, [], true).changes.map((c) => c.pattern)).toEqual(expect.arrayContaining(['later', 'evening_activity']));
    expect(detect(p, END, [], false).changes.map((c) => c.pattern)).not.toContain('evening_activity');
  });

  it('a time zone change in the latest nights gives too little data, not a change', () => {
    const data = simulate({ end: END, days: 60, events: [{ kind: 'timezone', from: d(1), offsetMin: 360 }] });
    const a = assessRhythm(data, END, 'x');
    expect(a.insufficient?.reason).toBe('timezone');
  });

  it('a missed check-in is never evidence: the estimate takes no entries at all', () => {
    expect(assessRhythm.length).toBeLessThanOrEqual(4);
    const data = simulate({ end: END, days: 60 });
    expect(assessRhythm(data, END, 'x').status).toBe('stable');
  });

  it('one course keeps its start while the change goes on', () => {
    const data = simulate({ end: END, days: 60, events: [{ kind: 'episode', start: addDays(END, 3), type: 'up', leadNights: 7 }] });
    const y = assessRhythm(data, d(1), 'x');
    const t = assessRhythm(data, END, 'x', { previous: y });
    if (y.status === 'change') expect(t.courseStart).toBe(y.courseStart);
    expect(t.status).toBe('change');
  });
});

describe('the short words for Hem', () => {
  const c = (pattern: RhythmChange['pattern'], n = 3): RhythmChange => ({ pattern, nights: Array.from({ length: n }, (_, i) => d(n - 1 - i)), values: [], usual: '' });

  it('names what changed without values or a pulse share', () => {
    expect(changeHeadline([c('later'), c('shorter'), c('evening_activity')])).toBe('Senare och kortare sömn');
    expect(changeHeadline([c('later')])).toBe('Senare insomning');
    expect(changeHeadline([c('shorter')])).toBe('Kortare sömn');
    expect(changeHeadline([c('earlier'), c('longer')])).toBe('Tidigare och längre sömn');
    expect(changeHeadline([c('later'), c('longer')])).toBe('Senare insomning och längre sömn');
    expect(changeHeadline([c('irregular', 6)])).toBe('Oregelbundna sovtider');
    expect(changeHeadline([c('evening_activity', 2)])).toBe('Förhöjd puls senare på kvällen');
    for (const p of ['later', 'shorter', 'evening_activity'] as const) expect(changeHeadline([c(p)])).not.toMatch(/\d|%/);
  });

  it('says how much in one short line', () => {
    expect(changeScope([c('later'), c('shorter')])).toBe('Tre nätter i rad.');
    expect(changeScope([c('irregular', 6)])).toBe('Den senaste veckan.');
    expect(changeScope([c('evening_activity', 2)])).toBe('Två kvällar i rad.');
  });

  it('a stable answer does not claim that nothing changed', () => {
    const a = assessRhythm(simulate({ end: END, days: 60 }), END, 'x');
    expect(a.status).toBe('stable');
    expect(a.text.change).toMatch(/^Inget tydligt nytt mönster/);
  });
});

describe('direction from the person\u2019s own history', () => {
  const ep = (start: string, type: EpisodeStart['type']): EpisodeStart => ({ id: start, start, end: addDays(start, 20), type, source: 'self_retro', createdAt: '' });

  function withHistory(events: Parameters<typeof simulate>[0]['events']): RhythmData {
    return simulate({ end: END, days: 200, seed: 3, events: [...(events ?? []), { kind: 'episode', start: addDays(END, 1), type: 'up' }] });
  }

  it('supports up when the same pattern came before an earlier up episode and never in stable periods', () => {
    const data = withHistory([{ kind: 'episode', start: d(100), type: 'up' }]);
    const a = assessRhythm({ ...data, episodes: data.episodes.filter((e) => e.start < END) }, END, 'x');
    expect(a.direction?.value).toBe('up');
    expect(a.direction?.reason).toBe('supported');
    expect(a.text.direction).toMatch(/^Liknar mönstret före en tidigare uppvarvad period, som började/);
    expect(directionHeadline(a.direction)).toBe('Liknar mönstret före en tidigare uppvarvad period');
    expect(a.text.direction).toContain('datum du angav i efterhand');
  });

  it('is unclear when the same pattern also came during a stable week', () => {
    const data = withHistory([{ kind: 'episode', start: d(100), type: 'up' }, { kind: 'late_week', from: d(60), nights: 4 }]);
    const a = assessRhythm({ ...data, episodes: data.episodes.filter((e) => e.start < END) }, END, 'x');
    expect(a.direction?.value).toBe('unclear');
    expect(a.direction?.reason).toBe('also_stable');
    expect(a.text.direction).toMatch(/Samma mönster fanns också en gång under .* dagar utanför registrerade perioder.*Därför går det inte att säga åt vilket håll det pekar/);
  });

  it('is unclear without documented episodes', () => {
    const data = withHistory([]);
    const p = prepare(data.measured, data.activity, d(199), END);
    expect(directionFor(p, END, 'later', [], true, d(199)).reason).toBe('no_episodes');
  });

  it('is unclear when the pattern came before both up and down episodes', () => {
    const data = withHistory([{ kind: 'episode', start: d(100), type: 'up' }]);
    const p = prepare(data.measured, data.activity, d(199), END);
    // The same run-up documented once as up and once as down.
    const r = directionFor(p, END, 'later', [ep(d(99), 'up'), { ...ep(d(99), 'down'), id: 'other' }], true, d(199));
    expect(r.reason).toBe('both');
    expect(r.value).toBe('unclear');
  });

  it('is unclear when the pattern never came before a documented episode', () => {
    const data = withHistory([{ kind: 'episode', start: d(100), type: 'down' }]);
    const p = prepare(data.measured, data.activity, d(199), END);
    const r = directionFor(p, END, 'later', data.episodes.filter((e) => e.start < END), true, d(199));
    expect(r.reason).toBe('no_match');
  });
});

describe('the traffic light (rules 1.6.0)', () => {
  function entry(date: string, partial: Partial<Entry> = {}): Entry {
    return { id: `e_${date}`, date, createdAt: `${date}T21:00:00`, kind: 'checkin', transcript: '', mood: 0, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null, ...partial };
  }
  const plan: PlanItem[] = [
    { id: 'e1', kind: 'early', text: 'Sover mindre', order: 0, approvedAt: '' },
    { id: 'r1', kind: 'serious', text: 'Slutar äta', order: 0, approvedAt: '' },
  ];
  const ps = { normalState: '', sleepThresholdHours: 5 };
  const r = (p: Partial<RhythmScoreInput> = {}): RhythmScoreInput => ({ date: END, computedAt: 'x', status: 'change', direction: 'up', patterns: ['later'], text: 'Tre nätter i rad har du somnat senare än vanligt.', use: true, ...p });

  it('shows the level with and without the signal, and counts it only when chosen', () => {
    const shown = score({ entry: entry(END), matches: [], plan, planSettings: ps, history: [], rhythm: r({ use: false }) });
    expect(shown.level).toBe('green');
    expect(shown.rhythm).toMatchObject({ used: false, with: { level: 'yellow', points: 1 }, without: { level: 'green', points: 0 } });
    const used = score({ entry: entry(END), matches: [], plan, planSettings: ps, history: [], rhythm: r() });
    expect(used.level).toBe('yellow');
    expect(used.signals.find((s) => s.kind === 'rhythm')).toMatchObject({ points: 1, polarity: 'up', measured: true });
  });

  it('a change without a direction, a stable rhythm or too little data gives nothing', () => {
    for (const x of [r({ direction: 'unclear' }), r({ status: 'stable', direction: null }), r({ status: 'insufficient', direction: null })]) {
      expect(score({ entry: entry(END), matches: [], plan, planSettings: ps, history: [], rhythm: x }).level).toBe('green');
    }
  });

  it('context the person adds is shown with the signal and does not dismiss it (rules 1.6.0)', () => {
    const plain = rhythmSignalFor(r(), [])!;
    const withContext = rhythmSignalFor(r({ context: 'Resa' }), [])!;
    expect(withContext.points).toBe(plain.points);
    expect(withContext.points).toBe(1);
    expect(withContext.label).toContain('Sammanhang du lagt till: Resa.');
  });

  it('counts the same short sleep once', () => {
    const e = entry(END, { sleepHours: 4, sleepSource: 'garmin' });
    const s = score({ entry: e, matches: [], plan, planSettings: ps, history: [], rhythm: r({ patterns: ['shorter'] }) });
    expect(s.signals.find((x) => x.kind === 'rhythm')?.points).toBe(0);
    expect(s.signals.find((x) => x.kind === 'rhythm')?.label).toContain('den korta sömnen räknas redan');
    expect(s.points).toBe(1);
    // A later bedtime is not the sleep rule's: it counts.
    const later = score({ entry: e, matches: [], plan, planSettings: ps, history: [], rhythm: r({ patterns: ['later', 'shorter'] }) });
    expect(later.signals.find((x) => x.kind === 'rhythm')?.points).toBe(1);
  });

  it('never decides red on its own', () => {
    // A serious sign alone is yellow; with the rhythm signal as the "other sign" it would be red.
    const s = score({ entry: entry(END, { transcript: 'Slutar äta' }), matches: [{ planItemId: 'r1', quote: 'Slutar äta' }], plan, planSettings: ps, history: [], rhythm: r() });
    expect(s.rhythm?.without.level).toBe('yellow');
    expect(s.level).toBe('yellow');
    expect(s.reason).toBe('passive_cap');
    expect(levelFromSignals([{ kind: 'rhythm', points: 1, label: '', measured: true }], 0).level).toBe('yellow');
  });

  it('never lowers a warning', () => {
    const e = entry(END, { transcript: 'Sover mindre, slutar äta' });
    const m = [{ planItemId: 'e1', quote: 'Sover mindre' }, { planItemId: 'r1', quote: 'slutar äta' }];
    const without = score({ entry: e, matches: m, plan, planSettings: ps, history: [] });
    const withR = score({ entry: e, matches: m, plan, planSettings: ps, history: [], rhythm: r() });
    expect(without.level).toBe('red');
    expect(withR.level).toBe('red');
  });

  it('shows the effect on later days through the history rule', () => {
    // Three yellow days, then green, then a day with 2 points: red only if four of the seven days before were not green.
    const dates = [d(6), d(5), d(4), d(3), d(2)];
    const entries: Entry[] = [...dates.map((x) => entry(x)), entry(d(1), { transcript: 'Sover mindre', mood: 2 })];
    const yellow = (e: Entry): Assessment => ({ id: `a_${e.id}`, entryId: e.id, date: e.date, createdAt: '', level: 'green', points: 0, signals: [], sentence: '', method: 'wordmatch', model: null, promptId: '', promptVersion: '', baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 }, inputs: { rulesVersion: '1.5.0', sentText: null, rawAnswer: null, signs: plan, matches: e.transcript ? [{ planItemId: 'e1', quote: 'Sover mindre' }] : [], planSettings: { sleepThresholdHours: 5 }, garmin: {}, medication: {}, baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 } } } as unknown as Assessment);
    const assessments = entries.map(yellow);
    const ctx = { plan, planSettings: ps, garmin: {}, medication: {} };
    const changeOn = new Set([d(6), d(5), d(4)]);
    const run = (use: boolean) => recomputeHistory(entries, assessments, { ...ctx, rhythm: (date) => (changeOn.has(date) ? r({ date, use }) : null) });
    const off = run(false), on = run(true);
    expect(off.map((x) => x.after.level)).toEqual(['green', 'green', 'green', 'green', 'green', 'yellow']);
    expect(on.map((x) => x.after.level)).toEqual(['yellow', 'yellow', 'yellow', 'green', 'green', 'red']);
  });
});

describe('the evaluation: played back in time order (simulated)', () => {
  it('uses only what was there that morning: the same call with or without later data', () => {
    const { data } = simulatedYear(END);
    const day = d(120);
    const cut = (x: RhythmData): RhythmData => ({
      measured: Object.fromEntries(Object.entries(x.measured).filter(([k]) => k <= day)),
      activity: Object.fromEntries(Object.entries(x.activity).filter(([k]) => k <= day)),
      episodes: x.episodes.filter((e) => e.start <= addDays(day, -8)),
    });
    const full = dailyCalls(data, day, day, null);
    const past = dailyCalls(cut(data), day, day, null);
    for (const m of ['notice', 'sleep', 'sleep_activity'] as const) expect(past[m].get(day)).toBe(full[m].get(day));
  });

  it('reports every rate with its counts, per episode type, and says when there are too few', () => {
    const { data } = simulatedYear(END);
    const ev = evaluateRhythm(data, { to: END, simulated: true });
    expect(ev.parts.map((p) => p.name)).toEqual(['utveckling', 'test']);
    const text = evaluationReport(ev);
    expect(text).toMatch(/^> \*\*Simulerade testfall\.\*\*/);
    expect(text).toMatch(/\d+ av \d+ \(för få för en andel\)/);
    expect(text).toMatch(/Falsklarm/);
    expect(text).toContain('angivna i efterhand');
    expect(text).toContain('från klinisk bedömning');
    for (const p of ev.parts) for (const m of p.methods) expect(m.abstainDays).toBeLessThanOrEqual(m.days);
  });

  it('without documented episodes, alarms are not called false, and each alarm is listed with what the model saw', () => {
    const { data } = simulatedYear(END);
    const ev = evaluateRhythm({ ...data, episodes: [] }, { to: END });
    const text = evaluationReport(ev);
    expect(text).not.toContain('Falsklarm');
    expect(text).toContain('Larm, inga episoder att jämföra med');
    const m = ev.parts[1].methods.find((x) => x.method === 'sleep_activity')!;
    expect(m.alarms.length).toBe(m.falseAlarms);
    expect(m.alarms.every((r) => r.patterns.length > 0 && !r.startFollowed)).toBe(true);
    const notice = ev.parts[1].methods.find((x) => x.method === 'notice')!;
    expect(notice.alarms.every((r) => r.patterns.length === 0)).toBe(true);
  });

  it('never takes the app\u2019s colours as truth: the evaluation has no input for them', () => {
    expect(evaluateRhythm.length).toBe(2);
  });
});

describe('on the phone', () => {
  async function repoWith(data: RhythmData, mode: 'show' | 'use' = 'show') {
    const repo = await Repository.create(memoryBackend());
    await repo.saveGarminDays(Object.values(data.measured), END);
    await repo.kvSet(ACTIVITY_KEY, data.activity);
    await repo.updateGarminStatus({ connected: true });
    await repo.updateSettings({ rhythm: mode });
    return repo;
  }

  it('a week without entries gives a card on Hem, once per course (acceptance)', async () => {
    const repo = await repoWith(simulate({ end: END, days: 60, events: [{ kind: 'episode', start: addDays(END, 1), type: 'up' }] }));
    expect(repo.entries()).toHaveLength(0);
    const now = new Date(`${END}T08:00:00`);
    await updateRhythm(repo, now);
    const card = rhythmCard(repo, now)!;
    expect(card.kind).toBe('rhythm');
    expect(card.assessment.text.change).toContain('somnat senare än vanligt');
    await markRhythmSeen(repo, card.id);
    expect(rhythmCard(repo, now)).toBeNull();
  });

  it('too little data for two mornings gives a card that says so (acceptance)', async () => {
    const repo = await repoWith(simulate({ end: END, days: 60, events: [{ kind: 'not_worn', from: d(4), days: 5 }] }));
    await updateRhythm(repo, new Date(`${d(1)}T08:00:00`));
    await updateRhythm(repo, new Date(`${END}T08:00:00`));
    const card = rhythmCard(repo, new Date(`${END}T08:00:00`))!;
    expect(card.kind).toBe('rhythmData');
    expect(card.assessment.text.change).toMatch(/^För lite data\./);
  });

  it('context is optional, saved with the course, and the change stays', async () => {
    const repo = await repoWith(simulate({ end: END, days: 60, events: [{ kind: 'episode', start: addDays(END, 1), type: 'up' }] }), 'use');
    const a = (await updateRhythm(repo, new Date(`${END}T08:00:00`)))!;
    expect(rhythmScoreInput(repo, END)?.context).toBeUndefined();
    await explainCourse(repo, a.courseStart!, 'Resa');
    expect(rhythmScoreInput(repo, END)?.context).toBe('Resa');
    expect(rhythmScoreInput(repo, END)?.status).toBe('change');
    expect(rhythmCard(repo, new Date(`${END}T08:00:00`))?.kind).toBe('rhythm');
  });

  it('the episode starts are kept apart and used by the next estimate', async () => {
    const data = simulate({ end: END, days: 200, seed: 3, events: [{ kind: 'episode', start: d(100), type: 'up' }, { kind: 'episode', start: addDays(END, 1), type: 'up' }] });
    const repo = await repoWith(data);
    await saveEpisode(repo, { ...data.episodes[0], source: 'clinical' });
    const a = (await updateRhythm(repo, new Date(`${END}T08:00:00`)))!;
    expect(a.direction?.matches[0]?.source).toBe('clinical');
    expect(repo.entries()).toHaveLength(0);
  });

  it('fetches heart rate only for days missing or fetched before they were over', () => {
    expect(activityDaysToFetch({}, END)).toHaveLength(8);
    const have = { [d(3)]: { fetchedAt: `${d(2)}T08:00:00.000Z` }, [d(2)]: { fetchedAt: `${d(2)}T20:00:00.000Z` } } as never;
    expect(activityDaysToFetch(have, END)).not.toContain(d(3));
    expect(activityDaysToFetch(have, END)).toContain(d(2));
  });
});

describe('episode dates typed on a number pad', () => {
  const { formatDateInput, isDateKey } = jest.requireActual('../src/core/analysis/dates') as typeof import('../src/core/analysis/dates');
  it('puts in the hyphens while typing, so only digits are needed', () => {
    expect(formatDateInput('2025')).toBe('2025');
    expect(formatDateInput('20250')).toBe('2025-0');
    expect(formatDateInput('202503')).toBe('2025-03');
    expect(formatDateInput('2025030')).toBe('2025-03-0');
    expect(formatDateInput('20250303')).toBe('2025-03-03');
    expect(formatDateInput('2025-03-03')).toBe('2025-03-03');
    expect(formatDateInput('2025 03 03 12')).toBe('2025-03-03');
    // Deleting the last digit after a hyphen leaves the digits before it.
    expect(formatDateInput('2025-03-')).toBe('2025-03');
  });
  it('knows a real calendar date', () => {
    expect(isDateKey('2025-03-03')).toBe(true);
    expect(isDateKey('2024-02-29')).toBe(true);
    expect(isDateKey('2025-02-29')).toBe(false);
    expect(isDateKey('2025-13-01')).toBe(false);
    expect(isDateKey('2025-3-3')).toBe(false);
  });
});

describe('heart rate for every earlier day, by itself while the app is open', () => {
  const svc = jest.requireActual('../src/services/rhythm') as typeof import('../src/services/rhythm');
  async function setup() {
    const data = simulate({ end: END, days: 40 });
    const repo = await Repository.create(memoryBackend());
    await repo.saveGarminDays(Object.values(data.measured), END);
    await repo.updateGarminStatus({ connected: true });
    await repo.updateSettings({ rhythm: 'show' });
    const asked: string[] = [];
    const client = {
      heartRate: async (date: string) => {
        asked.push(date);
        // Garmin has no pulse for the oldest ten days.
        if (date < d(30)) return { date, activeMinutes: Array(24).fill(null), worn: Array(24).fill(0), restingHr: null, tzOffsetMin: 60, lastReading: null };
        return data.activity[date] ?? null;
      },
    } as never;
    return { repo, client, asked };
  }

  it('fetches every day with sleep and the day before, saves one document per month, and remembers days without pulse', async () => {
    const { repo, client, asked } = await setup();
    const now = new Date(`${END}T08:00:00`);
    const want = svc.missingActivityDays(repo, END);
    expect(want[0]).toBe(d(8));
    await svc.fetchAllActivity(repo, { client, pauseMs: 0, now });
    expect(asked).toEqual(want);
    expect(repo.kvKeys(svc.ACTIVITY_MONTH_PREFIX).length).toBeGreaterThanOrEqual(2);
    expect(svc.activityProgress(repo)).toMatchObject({ done: want.length, total: want.length, running: false, finished: true });
    // Nothing left: days Garmin had nothing for are not asked again.
    expect(svc.missingActivityDays(repo, END)).toEqual([]);
    asked.length = 0;
    await svc.fetchAllActivity(repo, { client, pauseMs: 0, now });
    expect(asked).toEqual([]);
  });

  it('continues where it stopped when the app went to the background', async () => {
    const { repo, client, asked } = await setup();
    const now = new Date(`${END}T08:00:00`);
    const total = svc.missingActivityDays(repo, END).length;
    let n = 0;
    await svc.fetchAllActivity(repo, { client, pauseMs: 0, now, cancelled: () => ++n > 12 });
    expect(svc.activityProgress(repo)).toMatchObject({ done: 12, running: false, finished: false });
    await svc.fetchAllActivity(repo, { client, pauseMs: 0, now });
    expect(asked.length).toBe(total);
    expect(new Set(asked).size).toBe(total);
    expect(svc.activityProgress(repo)).toMatchObject({ done: total, total, finished: true });
  });

  it('does nothing when Dygnsrytm is off', async () => {
    const { repo, client, asked } = await setup();
    await repo.updateSettings({ rhythm: 'off' });
    await svc.fetchAllActivity(repo, { client, pauseMs: 0 });
    expect(asked).toEqual([]);
  });
});

describe('the replay after review: honest rates and no knowledge from later', () => {
  const ev = jest.requireActual('../src/core/analysis/rhythmEval') as typeof import('../src/core/analysis/rhythmEval');

  it('gives alarms per 30 judged days and per 30 calendar days, with the counts', () => {
    expect(ev.rate(23, 180, 445)).toBe('3,8 per 30 bedömda dagar, 1,6 per 30 kalenderdagar (23 på 180 bedömda av 445 dagar)');
    expect(ev.rate(1, 20, 25)).toBe('1 på 20 bedömda av 25 dagar');
  });

  it('an end date set later never reaches back into an earlier day', () => {
    const e = { id: 'x', start: d(100), end: d(10), type: 'up' as const, source: 'self_retro' as const, createdAt: '' };
    expect(ev.episodesKnownOn([e], d(95))).toEqual([]);
    expect(ev.episodesKnownOn([e], d(70))[0].end).toBe(d(70));
    const { data } = simulatedYear(END);
    const day = d(70);
    const a = ev.dailyCalls({ ...data, episodes: [e] }, day, day, null);
    const b = ev.dailyCalls({ ...data, episodes: [{ ...e, end: d(60) }] }, day, day, null);
    for (const m of ['sleep', 'sleep_activity'] as const) expect(a[m].get(day)).toBe(b[m].get(day));
  });

  it('says what the replay assumes, and how much the episode labels change the alarms', () => {
    const { data } = simulatedYear(END);
    const r = ev.evaluateRhythm(data, { to: END, simulated: true });
    const text = ev.assumptions(r);
    expect(text).toContain('fanns hämtade på morgonen');
    expect(text).toMatch(/gav \d+ larm med episoderna utanför sitt vanliga mönster och \d+ utan någon episodmärkning/);
  });
});

describe('no documented episodes: a change, but never support for a direction', () => {
  const svc = jest.requireActual('../src/services/rhythm') as typeof import('../src/services/rhythm');
  it('shows the change, gives no direction and no points, also when the person chose Använd', async () => {
    const data = simulate({ end: END, days: 60, events: [{ kind: 'episode', start: addDays(END, 1), type: 'up' }] });
    const repo = await Repository.create(memoryBackend());
    await repo.saveGarminDays(Object.values(data.measured), END);
    await repo.kvSet(ACTIVITY_KEY, data.activity);
    await repo.updateSettings({ rhythm: 'use' });
    expect(svc.episodeStarts(repo)).toEqual([]);
    const a = (await updateRhythm(repo, new Date(`${END}T08:00:00`)))!;
    expect(a.status).toBe('change');
    expect(a.direction).toMatchObject({ value: 'unclear', reason: 'no_episodes', matches: [] });
    const input = rhythmScoreInput(repo, END)!;
    expect(input).toMatchObject({ use: true, direction: 'unclear' });
    const e: Entry = { id: 'e', date: END, createdAt: `${END}T21:00:00`, kind: 'checkin', transcript: '', mood: 0, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null };
    const s = score({ entry: e, matches: [], plan: [], planSettings: { normalState: '', sleepThresholdHours: 5 }, history: [], rhythm: input });
    expect(s.level).toBe('green');
    expect(s.signals.find((x) => x.kind === 'rhythm')?.points).toBe(0);
    expect(s.rhythm).toMatchObject({ used: false, with: { level: 'green' }, without: { level: 'green' } });
  });
});

describe('sleep and stress for the last year, by themselves', () => {
  const hist = jest.requireActual('../src/services/garminHistory') as typeof import('../src/services/garminHistory');
  it('does nothing without Garmin, and nothing more once the year is fetched', async () => {
    const repo = await Repository.create(memoryBackend());
    let calls = 0;
    const fetch = (async () => { calls++; return { ok: true, status: 200, text: async () => '[]' }; }) as never;
    await hist.autoBackfillGarmin(repo, { fetch, pauseMs: 0 });
    expect(calls).toBe(0);
    await repo.updateGarminStatus({ connected: true });
    await repo.kvSet('garminBackfill', { from: d(365), to: d(1), nextEnd: null, emptyRounds: 0, fetchedDays: 300, oldestWithData: d(300) });
    await hist.autoBackfillGarmin(repo, { fetch, pauseMs: 0 });
    expect(calls).toBe(0);
  });
});
