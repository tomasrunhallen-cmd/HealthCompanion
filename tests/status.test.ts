// Läget i dag: the code picks the facts and the tone; the model only words them, checked. Invented data only.
import type { FetchLike } from '../src/adapter/http';
import { addDays } from '../src/core/analysis/dates';
import { checkStatus, codeStatusText, statusFacts, type StatusDay, type StatusInput } from '../src/core/plan/status';
import { destinationKey } from '../src/llm/config';
import { setSecret } from '../src/platform/secrets';
import { LLM_KEY_NAME } from '../src/services/llm';
import { makeStatus, statusToday } from '../src/services/status';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

jest.mock('../src/platform/secrets', () => {
  const mem = new Map<string, string>();
  return { secretsPersist: false, getSecret: async (n: string) => mem.get(n) ?? null, setSecret: async (n: string, v: string) => void mem.set(n, v), deleteSecret: async (n: string) => void mem.delete(n) };
});

const TODAY = '2026-11-26';
const back = (n: number) => addDays(TODAY, -n);
const green = (n: number, over: Partial<StatusDay> = {}): StatusDay => ({ date: back(n), level: 'green', mood: 0, sleepHours: 7.5, akut: false, ...over });
const R = [{ id: 'sleep', text: 'Sömn 23-07', frequency: { kind: 'daily' as const } }, { id: 'meds', text: 'Medicin', frequency: { kind: 'daily' as const } }, { id: 'walk', text: 'Promenad', frequency: { kind: 'weekly' as const, times: 1 } }];
// Evenings answered: all of the last 14. Sleep (every day) 5 of 7 now, 2 before; Medicin every evening; Promenad (once a week) once in each week.
const answered = Array.from({ length: 14 }, (_, i) => back(i));
const ticks = [
  ...[0, 1, 2, 4, 5].map((n) => ({ date: back(n), routineId: 'sleep' })), ...[8, 11].map((n) => ({ date: back(n), routineId: 'sleep' })),
  ...answered.map((date) => ({ date, routineId: 'meds' })),
  ...[1, 9].map((n) => ({ date: back(n), routineId: 'walk' })),
];
const input = (over: Partial<StatusInput> = {}): StatusInput => ({
  today: TODAY, days: Array.from({ length: 21 }, (_, i) => green(i)), routines: R, ticks, answeredDates: answered, events: [], upward: false, ...over,
});

describe('what is lifted, and in which tone', () => {
  it('judges each routine against its own goal, and lifts one begun to go better before one kept', () => {
    const f = statusFacts(input());
    expect(f.tone).toBe('pepp');
    expect(f.highlights).toEqual([
      '”Sömn 23-07” (mål: varje dag) har kommit igång: 5 av 7 kvällar den senaste veckan, mot 2 av 7 kvällar veckan innan.',
      'Du har nått målet för ”Medicin” (varje dag) två veckor i rad: 7 av 7 kvällar den senaste veckan och 7 av 7 kvällar veckan innan.',
      'Du har nått målet för ”Promenad” (en gång i veckan) två veckor i rad: 1 gång den senaste veckan och 1 gång veckan innan.',
    ]);
    expect(f.lines).toContain('Rutinerna mot sina mål senaste veckan: målet nått för 2 av 3.');
    expect(f.lines).toContain('Senaste 7 dagarna: 7 gröna.');
    expect(codeStatusText(f)).toBe(f.highlights.slice(0, 2).join(' '));
  });

  it('a weekly goal is the goal, not every evening: the same short of it is not lifted, reaching it is', () => {
    const gym = [{ id: 'gym', text: 'Träning', frequency: { kind: 'weekly' as const, times: 3 } }];
    const t = (ns: number[]) => ns.map((n) => ({ date: back(n), routineId: 'gym' }));
    expect(statusFacts(input({ routines: gym, ticks: t([0, 2, 4, 8]) })).highlights).toEqual(['”Träning” (mål: 3 gånger i veckan) har kommit igång: 3 gånger den senaste veckan, mot 1 gång veckan innan, så målet är nått.']);
    // Twice of three, as the week before: short of the goal and no change, so nothing is lifted.
    expect(statusFacts(input({ routines: gym, ticks: t([0, 2, 8, 10]) })).highlights).toEqual([]);
  });

  it('lifts the days after a larger event when they all look good', () => {
    const f = statusFacts(input({ events: [{ date: back(4), text: 'Flytten' }] }));
    expect(f.highlights).toContain('Dagarna efter ”Flytten” söndag 22 november har sett bra ut: 4 avstämningar sedan dess, alla gröna, och sömn i snitt 7,5 h.');
    const yellowAfter = statusFacts(input({ events: [{ date: back(4), text: 'Flytten' }], days: [green(0), green(1, { level: 'yellow' }), ...Array.from({ length: 19 }, (_, i) => green(i + 2))] }));
    expect(yellowAfter.highlights.join(' ')).not.toContain('Flytten');
  });

  it('a yellow or red day, or winding up, gives a calm tone and lifts nothing', () => {
    for (const f of [statusFacts(input({ days: [green(0, { level: 'yellow' }), ...Array.from({ length: 20 }, (_, i) => green(i + 1))] })), statusFacts(input({ upward: true }))]) {
      expect(f.tone).toBe('calm');
      expect(f.highlights).toEqual([]);
    }
  });

  it('a week when the emergency rule matched gives no summary and points to the plan', () => {
    const f = statusFacts(input({ days: [green(0), green(3, { akut: true, level: 'red' }), ...Array.from({ length: 18 }, (_, i) => green(i + 4))] }));
    expect(f.tone).toBe('plan');
    expect(codeStatusText(f)).toContain('Hjälp nu');
  });
});

describe('the model only words the facts', () => {
  const f = statusFacts(input());
  it('keeps a text that uses the facts', () => {
    expect(checkStatus({ text: 'Sömnen 23-07 har kommit igång, fem av sju kvällar mot två veckan innan. Och medicinen har du tagit varje kväll två veckor i rad.' }, f)).not.toBeNull();
  });
  it('drops a number not in the facts, a diagnosis word, a demand or a level of its own', () => {
    for (const text of ['Du sov 9 timmar i natt.', 'Du verkar mindre deprimerad nu.', 'Du måste fortsätta så här.', 'Du ligger på grön nivå i dag.', 'Ett. Två. Tre. Fyra.']) {
      expect([text, checkStatus({ text }, f)]).toEqual([text, null]);
    }
  });
  it('allows no cheering on a calm day', () => {
    const calm = statusFacts(input({ upward: true }));
    expect(checkStatus({ text: 'Fantastiskt bra vecka med medicinen!' }, calm)).toBeNull();
    expect(checkStatus({ text: 'Veckan har varit jämn. Ta det i din takt.' }, calm)).not.toBeNull();
  });
});

describe('made once a day, and again when the facts change', () => {
  it('calls the model once, keeps the text, makes it again after a new check-in, never more than twice more', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest', consentFor: destinationKey('mistral', '') });
    await setSecret(LLM_KEY_NAME, 'mk');
    const sent: string[] = [];
    const fetch: FetchLike = async (_u, init) => {
      sent.push(JSON.parse(init.body).messages[1].content);
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: 'Veckan har varit jämn.' }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
    };
    const now = new Date(2026, 10, 26, 9, 0);
    const save = async (date: string, mood: number) => repo.saveEntry(
      { id: `e_${date}`, date, createdAt: `${date}T20:00:00.000Z`, kind: 'checkin', transcript: 'En lugn dag på jobbet.', mood, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null } as never,
      { id: `a_${date}`, entryId: `e_${date}`, date, createdAt: '', level: 'green', points: 0, signals: [], sentence: '', method: 'wordmatch', model: null, promptId: null, promptVersion: null, baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 } },
    );
    await save('2026-11-25', 0);
    const first = await makeStatus(repo, { fetch }, now);
    expect([first.method, first.text, sent.length]).toEqual(['llm', 'Veckan har varit jämn.', 1]);
    expect(sent[0]).toContain('Senaste 7 dagarna: 1 grön, 6 utan avstämning.');
    expect(sent[0]).toContain('En lugn dag på jobbet.');
    expect(statusToday(repo, now)).toEqual(first);
    await makeStatus(repo, { fetch }, now);
    expect(sent).toHaveLength(1);
    await save('2026-11-24', 1);
    await makeStatus(repo, { fetch }, now);
    expect(sent).toHaveLength(2);
    await save('2026-11-23', 2);
    await makeStatus(repo, { fetch }, now);
    await save('2026-11-22', -1);
    const last = await makeStatus(repo, { fetch }, now);
    expect([sent.length, last.remakes]).toEqual([3, 2]);
  });
});
