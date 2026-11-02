import { createCompleter } from '../src/core/llm/complete';
import { referenceAdapter } from '../src/core/llm/fake';
import { loadTestSuite } from '../src/core/analysis/testcases';
import { modelChanges } from '../src/core/analysis/modelChanges';
import { buildContext, CORRECTIONS_SHOWN, PROFILE_BUDGET_CHARS } from '../src/core/context/buildContext';
import type { Assessment, ContextEntry, Entry } from '../src/core/domain/types';
import { createLlmMatcher } from '../src/core/analysis/llmMatcher';
import { runModelTest } from '../src/services/llm';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import { fixedAdapter } from '../src/core/llm/fake';

const entry: Entry = {
  id: 'e', date: '2026-11-01', createdAt: new Date(2026, 10, 1, 21).toISOString(), kind: 'checkin',
  transcript: 'Vanlig dag.', mood: 0, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null,
};

let n = 0;
function e(kind: ContextEntry['kind'], text: string, over: Partial<ContextEntry> = {}): ContextEntry {
  n++;
  const layer = ['trigger', 'false_alarm', 'medication', 'tone_yellow', 'tone_red', 'early', 'serious', 'action_yellow', 'action_red', 'relatives'].includes(kind)
    ? 'grund' : ['medication_taken', 'event', 'correction'].includes(kind) ? 'dagligt' : 'profil';
  return { id: `x${n}`, layer, kind, text, order: n, origin: 'user', createdAt: `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`, approvedAt: '2026', ...over } as ContextEntry;
}

describe('buildContext', () => {
  it('puts grund, profil, dagligt and corrections into the prompt variables', async () => {
    const bank = [
      e('early', 'Svarar inte på sms'),
      e('action_yellow', 'Ring Kim'),
      e('normal_state', 'Sover sju timmar'),
      e('trigger', 'Långa resor'),
      e('false_alarm', 'Sover kort natten före en tidig flight'),
      e('medication', 'Litium 600 mg'),
      e('tone_yellow', 'Rak och kort'),
      e('course', 'Sömnen kortas först, tre dagar senare kommer många projekt'),
      e('period_high', 'Våren 2024: sov fyra timmar, startade tre projekt'),
      e('typical_phrase', 'Lugn dag, inget särskilt'),
      e('medication_taken', 'Medicin', { date: '2026-11-01', taken: false }),
      e('event', 'Resa till Umeå', { date: '2026-11-05' }),
      e('event', 'Gammal händelse', { date: '2026-10-01' }),
      e('correction', 'Jag var bara trött', { date: '2026-10-30', correction: { assessmentId: 'a', verdict: 'disagree', planItemId: 'x1' } }),
    ];
    const ctx = buildContext({ entries: bank, entry, history: [] });
    const v = ctx.variables;
    expect(v.normallage).toBe('Sover sju timmar');
    expect(ctx.signs.map((s) => s.text)).toEqual(['Svarar inte på sms']);
    expect(v.grund).toContain('Utlösare som personen känner till:\n- Långa resor');
    expect(v.grund).toContain('Kända falsklarm (räkna dem inte som tecken):\n- Sover kort natten före en tidig flight');
    expect(v.grund).toContain('- Litium 600 mg');
    expect(v.grund).toContain('Önskad ton vid gult:\n- Rak och kort');
    expect(v.grund).not.toContain('Ring Kim'); // actions are not needed to judge the note
    expect(v.profil.indexOf('Kända förlopp')).toBeLessThan(v.profil.indexOf('Tidigare uppvarvade'));
    expect(v.profil).not.toContain('Sover sju timmar');
    expect(v.dagligt).toContain('Medicin i dag: inte tagen');
    expect(v.dagligt).toContain('torsdag 5 november: Resa till Umeå');
    expect(v.dagligt).not.toContain('Gammal händelse');
    expect(v.dagligt).toContain('De senaste 14 dagarna: 0 gröna, 0 gula, 0 röda, 14 dagar utan inlägg.');
    expect(v.rattelser).toBe('- fredag 30 oktober: Personen sa att bedömningen stämde inte om tecknet "Svarar inte på sms". "Jag var bara trött"');
  });

  it('keeps only the five latest corrections and keeps the profile within about 800 tokens', () => {
    const corrections = Array.from({ length: 8 }, (_, i) => e('correction', `rättelse ${i}`, { correction: { assessmentId: 'a', verdict: 'agree' } }));
    const long = Array.from({ length: 40 }, (_, i) => e('typical_phrase', `${'lång formulering '.repeat(10)}${i}`));
    const ctx = buildContext({ entries: [...corrections, ...long], entry, history: [] });
    expect(ctx.variables.rattelser.split('\n')).toHaveLength(CORRECTIONS_SHOWN);
    expect(ctx.variables.rattelser).toContain('rättelse 7');
    expect(ctx.variables.rattelser).not.toContain('rättelse 2');
    expect(ctx.variables.profil.length).toBeLessThanOrEqual(PROFILE_BUDGET_CHARS + 40);
    expect(ctx.variables.profil).toContain('(Profilen är förkortad.)');
  });

  it('an empty bank gives empty sections, not missing variables', () => {
    const v = buildContext({ entries: [], entry, history: [] }).variables;
    expect(v).toMatchObject({ normallage: '(inte ifyllt)', grund: '(inget ifyllt)', profil: '(inget ifyllt)', rattelser: '(inga rättelser än)' });
  });

  it('the model gets the context scrubbed, and the prompt file holds no user data', async () => {
    const fake = fixedAdapter(['{"matches":[],"sentence":"ok"}']);
    const matcher = createLlmMatcher({ completer: createCompleter(fake), model: 'm', names: () => ['Kim'] });
    const ctx = buildContext({ entries: [e('trigger', 'Bråk med Kim'), e('early', 'Svarar inte på sms')], entry, history: [] });
    await matcher.match('Vanlig dag.', ctx.signs, { normalState: '', sleepThresholdHours: 5 }, { variables: ctx.variables });
    expect(fake.calls[0].user).toContain('- Bråk med [NAMN]');
    expect(fake.calls[0].user).not.toContain('Kim');
    expect(fake.calls[0].system).not.toMatch(/Kim|sms/);
  });
});

describe('Testa modellen with the user\'s own context', () => {
  it('sends the user\'s false alarms and corrections along with the test cases', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addContextEntry({ kind: 'false_alarm', text: 'Kort sömn före tidiga flyg', origin: 'user' });
    await repo.addContextEntry({ kind: 'correction', text: 'Var bara trött', origin: 'correction', date: '2026-10-30', correction: { assessmentId: 'a', verdict: 'disagree' } });
    await repo.addContextEntry({ kind: 'early', text: 'Mitt eget tecken', origin: 'crisis_plan' });
    const calls: string[] = [];
    const ref = referenceAdapter(loadTestSuite().cases);
    const spy = { ...ref, async send(req: Parameters<typeof ref.send>[0]) { calls.push(req.user); return ref.send(req); } };
    const report = await runModelTest(createCompleter(spy), 'fake', undefined, repo.contextEntries());
    expect(report.approved).toBe(true);
    expect(calls[0]).toContain('Kort sömn före tidiga flyg');
    expect(calls[0]).toContain('Var bara trött');
    // The test plan's own signs are used, not the user's.
    expect(calls[0]).toContain('Svarar inte på sms');
    expect(calls[0]).not.toContain('Mitt eget tecken');
  });
});

describe('changing model', () => {
  it('leaves the context bank untouched', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addContextEntry({ kind: 'trigger', text: 'Resor', origin: 'user' });
    await repo.addPlanItems([{ id: 'p', kind: 'early', text: 'Svarar inte på sms' }]);
    await repo.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest' });
    const before = JSON.stringify(repo.contextEntries());
    await repo.updateLlmConfig({ provider: 'anthropic', model: 'claude-haiku-5-5', consentFor: null, lastTest: null });
    await repo.updateLlmConfig({ provider: null });
    expect(JSON.stringify(repo.contextEntries())).toBe(before);
  });

  it('finds the days the model or prompt changed', () => {
    const a = (date: string, model: string | null, v = '1.2.0', method: Assessment['method'] = 'llm') =>
      ({ date, createdAt: `${date}T20:00`, model, promptVersion: v, method }) as Assessment;
    expect(modelChanges([
      a('2026-11-01', 'mistral-small-latest'),
      a('2026-11-02', null, '', 'wordmatch'),
      a('2026-11-03', 'mistral-small-latest'),
      a('2026-11-04', 'mistral-medium-latest'),
      a('2026-11-05', 'mistral-medium-latest', '1.3.0'),
    ])).toEqual([
      { date: '2026-11-04', from: 'mistral-small-latest, prompt 1.2.0', to: 'mistral-medium-latest, prompt 1.2.0' },
      { date: '2026-11-05', from: 'mistral-medium-latest, prompt 1.2.0', to: 'mistral-medium-latest, prompt 1.3.0' },
    ]);
  });
});
