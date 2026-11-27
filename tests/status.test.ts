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
// TODAY is Thursday 26 November: this week is Monday 23 to today, last week 16–22, the week before 9–15.
const d = (day: number) => `2026-11-${String(day).padStart(2, '0')}`;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => d(a + i));
const R = [{ id: 'sleep', text: 'Sömn 23-07', frequency: daily }, { id: 'meds', text: 'Medicin', frequency: daily }, { id: 'gym', text: 'Träning', frequency: { kind: 'weekly' as const, times: 3 } }];
const answered = range(9, 26);
const tick = (id: string, days: string[]) => days.map((date) => ({ date, routineId: id }));
const ticks = [
  ...tick('sleep', [d(17), d(18), d(19), d(20), d(21), d(10), d(12)]),
  ...tick('meds', answered),
  ...tick('gym', [d(23), d(24), d(25), d(17)]),
];
const input = (over: Partial<StatusInput> = {}): StatusInput => ({
  today: TODAY, days: Array.from({ length: 18 }, (_, i) => green(i)), routines: R, ticks, answeredDates: answered, events: [], upward: false, ...over,
});
const texts = (i: StatusInput) => statusFacts(i).lines.map((l) => l.text);

describe('each sentence is a fixed fact, by calendar week', () => {
  it('come going last week, a goal confirmed both full weeks, a weekly goal already reached this week', () => {
    expect(texts(input())).toEqual([
      '”Sömn 23-07” kom igång förra veckan: fem kvällar, mot två kvällar veckan innan.',
      'Du nådde ditt mål för ”Medicin”, varje dag, både förra veckan och veckan innan.',
      'Du har redan nått veckans mål för ”Träning”, 3 gånger i veckan.',
    ]);
  });

  it('"kom igång" needs more confirmed times and enough evenings, not only a higher share', () => {
    const sparse = input({ routines: [R[0]], ticks: tick('sleep', [d(10), d(12), d(18)]), answeredDates: [d(9), d(10), d(11), d(12), d(18)] });
    expect(texts(sparse).join(' ')).not.toContain('kom igång');
  });

  it('a daily goal "both weeks" only when the ticks confirm the whole goal, not one evening a week', () => {
    const once = input({ routines: [R[1]], ticks: tick('meds', [d(11), d(18)]), answeredDates: [d(11), d(18)] });
    expect(texts(once).join(' ')).not.toContain('nådde ditt mål');
  });

  it('what was done this week is said plainly', () => {
    const walk = [{ id: 'walk', text: 'Kvällspromenad', frequency: { kind: 'weekly' as const, times: 4 } }];
    expect(texts(input({ routines: walk, ticks: tick('walk', [d(23), d(25), d(26), d(17)]) }))).toEqual(['Du har gjort ”Kvällspromenad” tre gånger den här veckan.']);
  });

  it('a weekday goal, Monday to Friday, can be reached without the weekend', () => {
    const work = [{ id: 'work', text: 'Sluta jobb i tid', frequency: { kind: 'weekdays' as const, days: [1, 2, 3, 4, 5] } }];
    const f = texts(input({ routines: work, ticks: tick('work', [...range(16, 20), ...range(9, 13)]) }));
    expect(f).toEqual(['Du nådde ditt mål för ”Sluta jobb i tid”, mån, tis, ons, tor och fre, både förra veckan och veckan innan.']);
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
    for (let i = 0; i < 20; i++) await repo.addContextEntry({ kind: 'routine_done', text: 'Medicin', origin: 'user', date: back(i), routineId: meds.id, done: true } as never, false);
    for (let i = 1; i < 20; i++) await save(back(i), 'green');
    expect(statusFacts(statusInput(repo, now))).toMatchObject({ tone: 'open', lines: [{ kind: 'kept' }] });
    await save(TODAY, 'red');
    expect(statusFacts(statusInput(repo, now)).tone).toBe('quiet');
    await save(TODAY, 'red', true);
    expect(statusFacts(statusInput(repo, now))).toMatchObject({ tone: 'plan', lines: [] });
  });
});
