import { assessEntry, SERIOUS_INTRO, seriousActions, wordMatcher, type SignMatcher } from '../src/analysis/assess';
import { loadTestSuite, type TestCase } from '../src/analysis/testcases';
import { akutLevel } from '../src/context/akut';
import type { Assessment } from '../src/domain/types';

const suite = loadTestSuite();
const byId = (id: string) => {
  const c = suite.cases.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};

/** A model that gives exactly the reference answer, so only the code decides the level. */
function referenceMatcher(c: TestCase): SignMatcher {
  return {
    async match() {
      return {
        matches: (c.reference ?? []).map((r) => ({ planItemId: r.planItemId, quote: r.quote })),
        sentence: null, method: 'llm', model: 'referenssvar', promptId: 'analys', promptVersion: '1.2.0',
      };
    },
  };
}

/** The case as the check-in would run it: the emergency rule first, then the reference answer. */
async function run(c: TestCase): Promise<Assessment> {
  const akut = akutLevel(c.entry.transcript);
  return assessEntry({
    entry: c.entry, plan: c.plan, planSettings: c.planSettings, history: c.history, garmin: c.garmin, context: c.context,
    matcher: akut ? wordMatcher : referenceMatcher(c),
    akut: akut === 'full', akutMild: akut === 'mild',
  });
}

describe('prompts/testfall.md', () => {
  it('has at least 18 cases with unique ids, all scenarios from the spec, and version 2.0.0', () => {
    expect(suite.version).toBe('2.3.0');
    expect(suite.cases.length).toBeGreaterThanOrEqual(18);
    expect(new Set(suite.cases.map((c) => c.id)).size).toBe(suite.cases.length);
    for (const id of [
      'lugn-dag', 'orkade-inte-svara', 'allvarligt-plus-annat', 'kant-falsklarm', 'omskrivet-tecken', 'negation',
      'precis-under-gult', 'precis-pa-gult', 'festkvall', 'tva-korta-natter-tva-tecken', 'medicin-missad-tva-dagar',
      'standard-allvarligt', 'akut-full', 'akut-mild', 'akut-sammansatt',
    ]) byId(id);
  });

  it('every case has a reference answer or an emergency verdict, never both', () => {
    for (const c of suite.cases) expect([c.id, c.reference == null]).toEqual([c.id, c.expectedAkut != null]);
  });

  for (const c of suite.cases) {
    it(`${c.id}: ${c.name}`, async () => {
      expect(akutLevel(c.entry.transcript)).toBe(c.expectedAkut);
      const a = await run(c);
      expect(a.level).toBe(c.expected);
      expect(seriousActions(a, c.plan) != null).toBe(c.expectedRedActions);
    });
  }
});

describe('what each case shows', () => {
  it('a serious sign alone stays yellow and shows the plan\'s actions at red', async () => {
    const c = byId('allvarligt-ensamt');
    const a = await run(c);
    expect([a.level, a.points]).toEqual(['yellow', 2]);
    expect(seriousActions(a, c.plan)!.map((p) => p.text)).toEqual(['Ring min vårdkontakt i dag', 'Be någon jag litar på att vara med mig i kväll']);
    expect(SERIOUS_INTRO).toBe('Ett av dina allvarliga tecken syntes. Din plan säger att du då ska:');
  });

  it('an early sign alone does not show the actions at red', async () => {
    const c = byId('orkade-inte-svara');
    expect(seriousActions(await run(c), c.plan)).toBeNull();
  });

  it('a known false alarm is in the prompt context and the reference answer matches nothing', async () => {
    const c = byId('kant-falsklarm');
    expect(c.context.some((e) => e.kind === 'false_alarm' && e.text.startsWith('Storhandla'))).toBe(true);
    expect(c.reference).toEqual([]);
    // Word matching on the phone would not know better than the words; the model must.
    expect((await run(c)).points).toBe(0);
  });

  it('a rewritten sign has none of the sign\'s words and still matches in the reference answer', () => {
    const c = byId('omskrivet-tecken');
    expect(c.entry.transcript).not.toMatch(/svara|sms/i);
    expect(c.reference!.map((r) => r.sign)).toEqual(['Svarar inte på sms']);
  });

  it('a negated sign matches nothing', () => {
    expect(byId('negation').reference).toEqual([]);
  });

  it('just under yellow gives 0 points, the same day with 4,9 hours of sleep gives exactly 1', async () => {
    const under = await run(byId('precis-under-gult'));
    const at = await run(byId('precis-pa-gult'));
    expect([under.level, under.points]).toEqual(['green', 0]);
    expect([at.level, at.points]).toEqual(['yellow', 1]);
    expect(at.signals.map((s) => s.kind)).toEqual(['sleep_low']);
  });

  it('the party night (asleep 03:00, 4 h, stress 1,6 times usual) is yellow; with yes to alcohol it is green', async () => {
    const party = await run(byId('festkvall'));
    expect([party.level, party.points]).toEqual(['yellow', 2]);
    expect(party.signals.map((s) => s.kind)).toEqual(['sleep_low', 'stress_high', 'late_sleep_no_entry']);
    expect(party.signals.find((s) => s.kind === 'late_sleep_no_entry')?.capped).toBe(true);
    const marked = await run(byId('festkvall-markerad'));
    expect([marked.level, marked.points]).toEqual(['green', 0]);
    expect(marked.signals.filter((s) => s.excused).map((s) => s.kind).sort()).toEqual(['late_sleep_no_entry', 'sleep_low', 'stress_high']);
  });

  it('two short nights in a row help make red; the same note after one short night is yellow', async () => {
    const one = await run(byId('en-kort-natt-tva-tecken'));
    const two = await run(byId('tva-korta-natter-tva-tecken'));
    expect(byId('en-kort-natt-tva-tecken').entry.transcript).toBe(byId('tva-korta-natter-tva-tecken').entry.transcript);
    expect([one.level, one.points]).toEqual(['yellow', 3]);
    expect([two.level, two.points]).toEqual(['red', 4]);
    expect(two.signals.filter((s) => s.persistent).map((s) => s.kind).sort()).toEqual(['sleep_low', 'sleep_low_consecutive']);
  });

  it('medication missed two evenings gives exactly 1 point; one evening gives none', async () => {
    const two = await run(byId('medicin-missad-tva-dagar'));
    expect([two.level, two.points]).toEqual(['yellow', 1]);
    expect(two.signals.map((s) => s.kind)).toEqual(['medication_missed']);
    const one = await run(byId('medicin-missad-en-dag'));
    expect([one.level, one.points]).toEqual(['green', 0]);
  });

  it('standard mode with four signs and short sleep would be red on points, and is yellow', async () => {
    const a = await run(byId('standard-allvarligt'));
    expect(byId('standard-allvarligt').plan.every((p) => p.origin === 'standard' && p.approvedAt == null)).toBe(true);
    expect(a.points).toBeGreaterThanOrEqual(4);
    expect([a.level, a.levelReason]).toEqual(['yellow', 'standard_cap']);
  });

  it('the emergency cases: full gives red with the emergency reason, mild keeps the usual level', async () => {
    const full = await run(byId('akut-full'));
    expect([full.level, full.levelReason, full.akut]).toEqual(['red', 'akut', true]);
    const mild = await run(byId('akut-mild'));
    expect([mild.level, mild.akutMild, mild.akut]).toEqual(['green', true, undefined]);
  });
});
