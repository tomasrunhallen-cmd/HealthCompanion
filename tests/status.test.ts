// Senaste veckan: the app's own sentences, each a fixed fact, against each routine's goal
// (granskning 26 november). Invented data only.
import { addDays } from '../src/core/analysis/dates';
import { statusFacts, type StatusDay, type StatusInput } from '../src/core/plan/status';
import { statusInput } from '../src/services/status';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const TODAY = '2026-11-26';
const back = (n: number) => addDays(TODAY, -n);
const green = (n: number, over: Partial<StatusDay> = {}): StatusDay => ({ date: back(n), level: 'green', akut: false, ...over });
const daily = { kind: 'daily' as const };
const R = [{ id: 'sleep', text: 'Sömn 23-07', frequency: daily }, { id: 'meds', text: 'Medicin', frequency: daily }, { id: 'walk', text: 'Kvällspromenad', frequency: { kind: 'weekly' as const, times: 3 } }];
const all14 = Array.from({ length: 14 }, (_, i) => back(i));
const ticks = [
  ...[0, 1, 2, 4, 5].map((n) => ({ date: back(n), routineId: 'sleep' })), ...[8, 11].map((n) => ({ date: back(n), routineId: 'sleep' })),
  ...all14.map((date) => ({ date, routineId: 'meds' })),
  ...[1, 3, 5, 8, 10, 12].map((n) => ({ date: back(n), routineId: 'walk' })),
];
const input = (over: Partial<StatusInput> = {}): StatusInput => ({
  today: TODAY, days: Array.from({ length: 14 }, (_, i) => green(i)), routines: R, ticks, answeredDates: all14, events: [], upward: false, ...over,
});
const texts = (i: StatusInput) => statusFacts(i).lines.map((l) => l.text);

describe('each sentence is a fixed fact', () => {
  it('a routine come going, a goal confirmed both weeks, in the app\'s own words', () => {
    expect(texts(input())).toEqual([
      '”Sömn 23-07” har kommit igång: fem kvällar den senaste veckan, mot två kvällar veckan innan.',
      'Du nådde ditt mål för ”Medicin”, varje dag, båda veckorna.',
      'Du nådde ditt mål för ”Kvällspromenad”, 3 gånger i veckan, båda veckorna.',
    ]);
  });

  it('"kommit igång" needs more confirmed times and enough evenings, not only a higher share', () => {
    const sparse = input({
      routines: [R[0]], ticks: [{ date: back(9), routineId: 'sleep' }, { date: back(11), routineId: 'sleep' }, { date: back(2), routineId: 'sleep' }],
      answeredDates: [back(8), back(9), back(10), back(11), back(2)],
    });
    expect(texts(sparse).join(' ')).not.toContain('kommit igång');
  });

  it('a daily goal "both weeks" only when the ticks confirm the whole goal, not one evening a week', () => {
    const once = input({ routines: [R[1]], ticks: [{ date: back(1), routineId: 'meds' }, { date: back(8), routineId: 'meds' }], answeredDates: [back(1), back(8)] });
    expect(texts(once).join(' ')).not.toContain('nådde ditt mål');
  });

  it('what was done is said plainly, also without a change', () => {
    const walk = [{ id: 'walk', text: 'Kvällspromenad', frequency: { kind: 'weekly' as const, times: 4 } }];
    expect(texts(input({ routines: walk, ticks: [1, 3, 5, 8, 10, 12].map((n) => ({ date: back(n), routineId: 'walk' })) }))).toEqual(['Du gjorde ”Kvällspromenad” tre gånger den senaste veckan.']);
  });

  it('after an event: the check-ins there are, all green; the person reads what it means', () => {
    const days = [green(0), green(2), ...Array.from({ length: 8 }, (_, i) => green(i + 6))];
    expect(texts(input({ routines: [], days, events: [{ date: back(4), text: 'Flytten' }] }))).toEqual(['Dina två avstämningar sedan ”Flytten” 22 november har varit gröna.']);
  });

  it('nothing concrete: silent', () => {
    expect(texts(input({ routines: [], ticks: [] }))).toEqual([]);
  });
});

describe('the state decides', () => {
  it('a yellow day or winding up: only what was done, never "kommit igång" or an event', () => {
    for (const i of [input({ days: [green(0, { level: 'yellow' }), ...Array.from({ length: 13 }, (_, n) => green(n + 1))] }), input({ upward: true })]) {
      const f = statusFacts(i);
      expect(f.tone).toBe('quiet');
      expect(f.lines.map((l) => l.kind)).not.toContain('started');
      expect(f.lines.map((l) => l.kind)).not.toContain('after_event');
    }
  });

  it('a week with a stopped note: no sentences, only where help is', () => {
    const f = statusFacts(input({ days: [green(0), green(3, { akut: true, level: 'red' })] }));
    expect([f.tone, f.lines]).toEqual(['plan', []]);
  });

  it('acceptance (granskning 26 november): an encouraging line, then a red check-in, and the line is gone at once', async () => {
    const repo = await Repository.create(memoryBackend());
    const now = new Date(2026, 10, 26, 21, 0);
    await repo.addContextEntry({ kind: 'routine', text: 'Medicin', origin: 'user', approvedAt: '2026-11-01T00:00:00.000Z', routine: { track: true, reminder: null } } as never, false);
    const meds = repo.contextOf('routine')[0];
    const save = async (date: string, level: 'green' | 'red', akut = false) => repo.saveEntry(
      { id: `e_${date}`, date, createdAt: `${date}T20:00:00.000Z`, kind: 'checkin', transcript: '', mood: 0, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null } as never,
      { id: `a_${date}`, entryId: `e_${date}`, date, createdAt: '', level, points: 0, signals: [], sentence: '', method: 'wordmatch', model: null, promptId: null, promptVersion: null, baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 }, ...(akut ? { akut: true } : {}) } as never,
    );
    for (let i = 0; i < 14; i++) await repo.addContextEntry({ kind: 'routine_done', text: 'Medicin', origin: 'user', date: back(i), routineId: meds.id, done: true } as never, false);
    for (let i = 1; i < 14; i++) await save(back(i), 'green');
    expect(statusFacts(statusInput(repo, now))).toMatchObject({ tone: 'open', lines: [{ kind: 'kept' }] });
    await save(TODAY, 'red');
    expect(statusFacts(statusInput(repo, now)).tone).toBe('quiet');
    await save(TODAY, 'red', true);
    expect(statusFacts(statusInput(repo, now))).toMatchObject({ tone: 'plan', lines: [] });
  });
});
