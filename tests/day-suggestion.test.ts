// Routine frequency and the day's suggestion on Hem. The code counts how each routine has gone
// and puts forward the candidates; a language model chooses among them and words why. Its answer
// is checked, and the code's own order is used without a model or when the answer does not hold.

import type { FetchLike } from '../src/adapter/http';
import { addDays } from '../src/core/analysis/dates';
import type { ContextEntry } from '../src/core/domain/types';
import { checkSuggestion, codeSuggestion, suggestionInput } from '../src/core/plan/daySuggestion';
import { frequencyOf, frequencyText, rankDue, routineStatuses, suggestFrequency, weekday } from '../src/core/plan/routineFrequency';
import { destinationKey } from '../src/llm/config';
import { setSecret } from '../src/platform/secrets';
import { daySuggestion, makeDaySuggestion } from '../src/services/daySuggestion';
import { LLM_KEY_NAME } from '../src/services/llm';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

jest.mock('../src/platform/secrets', () => {
  const mem = new Map<string, string>();
  return { secretsPersist: false, getSecret: async (n: string) => mem.get(n) ?? null, setSecret: async (n: string, v: string) => void mem.set(n, v), deleteSecret: async (n: string) => void mem.delete(n) };
});

const TODAY = '2026-11-13'; // a Friday: three days left in the week, today included

let n = 0;
const routine = (text: string, over: Partial<ContextEntry> = {}): ContextEntry => ({
  id: `r${++n}`, layer: 'grund', kind: 'routine', text, order: n, origin: 'user', createdAt: '', approvedAt: '2026-01-01', plan: { polarity: 'both' }, ...over,
} as ContextEntry);
const done = (r: ContextEntry, date: string, ok = true): ContextEntry => ({
  id: `d_${r.id}_${date}`, layer: 'dagligt', kind: 'routine_done', text: r.text, order: 0, origin: 'user', createdAt: '', approvedAt: '', date, routineId: r.id, done: ok,
} as ContextEntry);

describe('Hur ofta en rutin ska göras', () => {
  it('is read from the routine\'s words as a suggestion, else every day', () => {
    expect(suggestFrequency('Promenad 3 gånger i veckan')).toEqual({ kind: 'weekly', times: 3 });
    expect(suggestFrequency('Yoga två ggr i veckan')).toEqual({ kind: 'weekly', times: 2 });
    expect(suggestFrequency('Varannan dag promenad')).toEqual({ kind: 'weekly', times: 3 });
    expect(suggestFrequency('Simma måndag och torsdag')).toEqual({ kind: 'weekdays', days: [1, 4] });
    expect(suggestFrequency('Tar min medicin varje kväll')).toEqual({ kind: 'daily' });
    expect(suggestFrequency('Drick ingen alkohol')).toBeNull();
    expect(frequencyOf(routine('Drick ingen alkohol'))).toEqual({ kind: 'daily' });
    // The person's own choice wins over the words.
    expect(frequencyOf(routine('Promenad 3 gånger i veckan', { routine: { track: true, reminder: null, frequency: { kind: 'weekly', times: 5 } } }))).toEqual({ kind: 'weekly', times: 5 });
    expect(frequencyText({ kind: 'weekdays', days: [1, 3, 5] })).toBe('mån, ons och fre');
    expect(weekday(TODAY)).toBe(5);
  });

  it('counts the week against the goal, the last four weeks, and what is due today', () => {
    const walk = routine('Promenad', { routine: { track: true, reminder: null, frequency: { kind: 'weekly', times: 3 } } });
    const swim = routine('Simma', { routine: { track: true, reminder: null, frequency: { kind: 'weekdays', days: [1, 4] } } });
    const meds = routine('Tar min medicin klockan 21');
    // Four earlier weeks of evenings: medicine every other evening, the walk twice a week.
    const log: ContextEntry[] = [];
    for (let i = 5; i <= 32; i++) {
      const d = addDays(TODAY, -i);
      log.push(done(meds, d, i % 2 === 0));
      if (weekday(d) === 2 || weekday(d) === 6) log.push(done(walk, d));
    }
    // This week: the walk once (Monday), medicine Monday to Thursday.
    for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) log.push(done(meds, d));
    log.push(done(walk, '2026-11-09'));
    const st = routineStatuses([walk, swim, meds, ...log], TODAY);
    const by = (r: ContextEntry) => st.find((s) => s.routine.id === r.id)!;
    expect(by(walk)).toMatchObject({ doneThisWeek: 1, goalThisWeek: 3, daysLeft: 3, dueToday: true, lastDone: '2026-11-09' });
    expect(by(walk).rate4w).toBeCloseTo(2 / 3);
    expect(by(swim).dueToday).toBe(false); // Monday and Thursday; today is Friday
    expect(by(meds)).toMatchObject({ doneThisWeek: 4, dueToday: true });
    expect(by(meds).rate4w).toBeCloseTo(0.5);
    // Two walks in three days is more pressing than a daily routine at half.
    expect(rankDue(st).map((s) => s.routine.text)).toEqual(['Promenad', 'Tar min medicin klockan 21']);
    expect(codeSuggestion(st, TODAY)[0].why).toBe('1 av 3 den här veckan, 3 dagar kvar.');
    // The medicine is kept half the time: it needs attention too.
    expect(codeSuggestion(st, TODAY).map((i) => i.routineId)).toEqual([walk.id, meds.id]);
  });
});

describe('Dagens förslag', () => {
  const walk = routine('Promenad med Kim', { routine: { track: true, reminder: null, frequency: { kind: 'weekly', times: 3 } } });
  const meds = routine('Tar min medicin klockan 21');
  const ctx = { today: TODAY, weekday: 5, yesterdayLevel: 'yellow' as const, sleepHours: 5.5, sleepLimit: 6.5 };

  it('the code suggests only what needs attention; when all goes well, the most pressing one', () => {
    const tea = routine('Kvällste klockan 21');
    const read = routine('Läser en stund');
    const log: ContextEntry[] = [];
    for (let i = 1; i <= 32; i++) for (const r of [tea, read]) log.push(done(r, addDays(TODAY, -i)));
    const st = routineStatuses([tea, read, ...log], TODAY);
    expect(codeSuggestion(st, TODAY)).toHaveLength(1);
  });

  it('sends only the routines\' words, scrubbed, and their numbers', () => {
    const input = suggestionInput(routineStatuses([walk, meds], TODAY), ctx, ['Kim']);
    expect(input.variables.kandidater).toContain('R1: Promenad med [NAMN]');
    expect(input.variables.kandidater).toContain('hur ofta: 3 gånger i veckan | 0 av 3 den här veckan, 3 dagar kvar');
    expect(input.variables.kandidater).not.toContain('Kim');
    expect(input.variables.dagslage).toBe('Veckodag: fredag.\nGårdagens nivå: gult.\nSömn i natt: 5,5 h (personens gräns 6,5 h).');
  });

  it('keeps only listed routines, once each, at most three, with a short reason', () => {
    const input = suggestionInput(routineStatuses([walk, meds], TODAY), ctx, []);
    const items = checkSuggestion({ suggestions: [
      { routine: 'R2', why: 'Medicinen håller rytmen efter en kort natt.' },
      { routine: 'R9', why: 'Finns inte.' },
      { routine: 'R2', why: 'Dubblett.' },
      { routine: 'R1', why: 'x'.repeat(200) },
    ] }, input);
    expect(items).toEqual([{ routineId: meds.id, why: 'Medicinen håller rytmen efter en kort natt.' }]);
    expect(checkSuggestion({ suggestions: [{ routine: 'R7', why: 'Nej.' }] }, input)).toBeNull();
    expect(checkSuggestion('inte json', input)).toBeNull();
  });

  it('is made once a day: by the model when one is set up, else by the code, and the code when the answer fails', async () => {
    const repo = await Repository.create(memoryBackend());
    for (const r of [walk, meds]) await repo.addContextEntry({ ...r, id: r.id });
    const now = new Date(2026, 10, 13, 8, 0);
    // No model: the code's order.
    const plain = await makeDaySuggestion(repo, {}, now);
    expect([plain.method, plain.items.map((i) => i.routineId)]).toEqual(['code', [walk.id, meds.id]]);

    await repo.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest', consentFor: destinationKey('mistral', '') });
    await setSecret(LLM_KEY_NAME, 'mk');
    const sent: string[] = [];
    let answer: object = { suggestions: [{ routine: 'R2', why: 'Medicinen håller rytmen efter en kort natt.' }] };
    const fetch: FetchLike = async (_u, init) => {
      sent.push(JSON.parse(init.body).messages[1].content);
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) };
    };
    // Kept for the day: asking again does not call the model.
    expect((await makeDaySuggestion(repo, { fetch }, now)).method).toBe('code');
    expect(sent).toHaveLength(0);
    const fresh = await makeDaySuggestion(repo, { fetch, force: true }, now);
    expect(fresh).toMatchObject({ method: 'llm', model: 'mistral-small-latest', promptVersion: '1.0.0', items: [{ routineId: meds.id }] });
    expect(daySuggestion(repo, now)).toEqual(fresh);
    expect(sent[0]).toContain('Rutiner att välja bland');
    // An answer that does not hold leaves the code's suggestion.
    answer = { suggestions: [{ routine: 'R5', why: 'Påhittad.' }] };
    expect((await makeDaySuggestion(repo, { fetch, force: true }, now)).method).toBe('code');
    // Turned off: no call at all.
    await repo.updateSettings({ routineSuggestions: false });
    const before = sent.length;
    expect((await makeDaySuggestion(repo, { fetch, force: true }, now)).method).toBe('code');
    expect(sent).toHaveLength(before);
  });
});
