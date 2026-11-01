// B1: web and phone use the same core. `npm run test:core` runs this file on web, Node,
// iOS and Android (jest-expo/universal); every test case must give the same level everywhere.

import { Platform } from 'react-native';
import { assessEntry, wordMatcher, type SignMatcher } from '../../src/core/analysis/assess';
import { loadTestSuite, type TestCase } from '../../src/core/analysis/testcases';
import { akutLevel } from '../../src/core/context/akut';
import { draftFromText } from '../../src/core/plan/importPlan';

const suite = loadTestSuite();

function reference(c: TestCase): SignMatcher {
  return {
    async match() {
      return { matches: (c.reference ?? []).map((r) => ({ planItemId: r.planItemId, quote: r.quote })), sentence: null, method: 'llm', model: 'referenssvar', promptId: 'analys', promptVersion: '1.2.0' };
    },
  };
}

describe(`core on ${Platform.OS}`, () => {
  it.each(suite.cases.map((c) => [c.id, c]))('%s gives the reference level', async (_id, c) => {
    const akut = akutLevel(c.entry.transcript);
    const a = await assessEntry({
      entry: c.entry, plan: c.plan, planSettings: c.planSettings, history: c.history, garmin: c.garmin, context: c.context,
      matcher: akut ? wordMatcher : reference(c), akut: akut === 'full', akutMild: akut === 'mild',
    });
    expect(a.level).toBe(c.expected);
  });

  it('sorts a plan the same way', () => {
    const d = draftFromText('Tidiga varningstecken\n\nMani\n- Pratar fort\n\nDepression\n- Orkar inte\n\nVid rött\n- Ring mottagningen');
    expect(d.rows.map((r) => [r.text, r.fields.kind, r.fields.polarity, r.fields.severity ?? r.fields.when])).toEqual([
      ['Pratar fort', 'sign', 'up', 'early'], ['Orkar inte', 'sign', 'down', 'early'], ['Ring mottagningen', 'action', 'both', 'serious'],
    ]);
  });
});
