// B3: reproducible assessments. Every assessment saves its inputs, the model's raw answer and
// the rules and prompt versions; "Räkna om historiken" shows the difference before saving.

import { createCompleter } from '../src/core/llm/complete';
import { fixedAdapter } from '../src/core/llm/fake';
import { assessEntry, wordMatcher } from '../src/core/analysis/assess';
import { createLlmMatcher } from '../src/core/analysis/llmMatcher';
import { recomputeHistory, outdatedDays } from '../src/core/analysis/recompute';
import { RULES_VERSION } from '../src/core/analysis/rules';
import type { Assessment, Entry, PlanItem } from '../src/core/domain/types';
import { applyRecompute, previewRecompute } from '../src/services/recompute';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const plan: PlanItem[] = [
  { id: 's1', kind: 'early', text: 'Svarar inte på sms', order: 0, approvedAt: '2026-01-01' },
  { id: 's2', kind: 'early', text: 'Handlar saker jag inte behöver', order: 1, approvedAt: '2026-01-01' },
];
const ps = { normalState: '', sleepThresholdHours: 5 };
const day = (date: string, transcript: string, over: Partial<Entry> = {}): Entry => ({
  id: `e_${date}`, date, createdAt: `${date}T21:00:00.000Z`, localTime: '21:00', kind: 'checkin', transcript,
  mood: 0, energy: 5, wordsPerMinute: null, sleepHours: 7.5, sleepSource: 'garmin', stressAvg: 25, ...over,
});

describe('what an assessment saves', () => {
  it('keeps the scrubbed note as sent, the raw answer, the rules and prompt versions and the measured days', async () => {
    const raw = '{"matches":[{"sign_id":1,"quote":"orkade inte svara på sms"}],"sentence":"Liknar ditt tecken."}';
    const matcher = createLlmMatcher({ completer: createCompleter(fixedAdapter([raw])), model: 'm', names: () => ['Kim'] });
    const garmin = { '2026-11-04': { date: '2026-11-04', sleepHours: 7.5, deepMinutes: null, remMinutes: null, sleepStart: '23:00', sleepEnd: '06:30', stressAvg: 25, stressHighMinutes: 5, bodyBatteryWake: null, fetchedAt: '' } };
    const a = await assessEntry({ entry: day('2026-11-04', 'Kim ringde, jag orkade inte svara på sms.'), plan, planSettings: ps, history: [], matcher, garmin });
    expect(a.inputs).toMatchObject({
      rulesVersion: RULES_VERSION,
      sentText: '[NAMN] ringde, jag orkade inte svara på sms.',
      rawAnswer: raw,
      matches: [{ planItemId: 's1', quote: 'orkade inte svara på sms' }],
      planSettings: { sleepThresholdHours: 5 },
    });
    expect(a.inputs!.signs.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(Object.keys(a.inputs!.garmin)).toEqual(['2026-11-04']);
    expect([a.promptId, a.promptVersion]).toEqual(['analys', expect.stringMatching(/^\d+\.\d+\.\d+$/)]);
  });

  it('sends and keeps no text with word matching', async () => {
    const a = await assessEntry({ entry: day('2026-11-04', 'Svarar inte på sms.'), plan, planSettings: ps, history: [], matcher: wordMatcher });
    expect([a.inputs!.sentText, a.inputs!.rawAnswer, a.level]).toEqual([null, null, 'yellow']);
  });
});

describe('Räkna om historiken', () => {
  async function week(): Promise<{ entries: Entry[]; assessments: Assessment[] }> {
    const entries: Entry[] = [];
    const assessments: Assessment[] = [];
    const notes = ['Vanlig dag.', 'Svarar inte på sms.', 'Svarar inte på sms. Handlar saker jag inte behöver.', 'Vanlig dag.'];
    for (const [i, note] of notes.entries()) {
      const e = day(`2026-11-0${i + 1}`, note);
      const history = entries.map((x, k) => ({ entry: x, level: assessments[k].level }));
      assessments.push(await assessEntry({ entry: e, plan, planSettings: ps, history, matcher: wordMatcher }));
      entries.push(e);
    }
    return { entries, assessments };
  }
  const ctx = { plan, planSettings: ps, garmin: {}, medication: {} };

  it('changes nothing when the rules are the same, and asks no model', async () => {
    const { entries, assessments } = await week();
    const days = recomputeHistory(entries, assessments, ctx);
    expect(days.map((d) => [d.after.level, d.changed, d.approximate])).toEqual(assessments.map((a) => [a.level, false, false]));
    expect(outdatedDays(assessments)).toBe(0);
  });

  it('shows the days a newer rules version changes, and later days follow the new levels', async () => {
    const { entries, assessments } = await week();
    // As if version 0.9.0 had given red already at 2 points.
    const old = assessments.map((a) => (a.points >= 2 ? { ...a, level: 'red' as const, inputs: { ...a.inputs!, rulesVersion: '0.9.0' } } : { ...a, inputs: { ...a.inputs!, rulesVersion: '0.9.0' } }));
    expect(outdatedDays(old)).toBe(4);
    const days = recomputeHistory(entries, old, ctx, new Date('2026-11-10T12:00:00Z'));
    const changed = days.filter((d) => d.changed);
    expect(changed.map((d) => [d.date, d.before.level, d.after.level, d.before.rulesVersion])).toEqual([['2026-11-03', 'red', 'yellow', '0.9.0']]);
    expect(changed[0].next.recomputed).toEqual({ at: '2026-11-10T12:00:00.000Z', fromRulesVersion: '0.9.0', level: 'red', points: 2 });
    expect(days.every((d) => d.next.inputs!.rulesVersion === RULES_VERSION)).toBe(true);
  });

  it('keeps the emergency rule\'s red and recomputes old days without inputs from today\'s plan', async () => {
    const { entries, assessments } = await week();
    const akut = { ...assessments[0], akut: true, level: 'red' as const };
    const { inputs: _i, ...noInputs } = assessments[1];
    const days = recomputeHistory(entries, [akut, noInputs as Assessment, ...assessments.slice(2)], ctx);
    expect(days[0].after.level).toBe('red');
    expect([days[1].approximate, days[1].after.level]).toEqual([true, 'yellow']);
  });

  it('saves only when asked, through the repository', async () => {
    const repo = await Repository.create(memoryBackend());
    const { entries, assessments } = await week();
    for (const [i, e] of entries.entries()) await repo.saveEntry(e, { ...assessments[i], level: 'red', inputs: { ...assessments[i].inputs!, rulesVersion: '0.9.0' } });
    const preview = previewRecompute(repo);
    expect(repo.assessments().every((a) => a.level === 'red')).toBe(true); // nothing saved yet
    const n = await applyRecompute(repo, preview);
    expect(n).toBe(4);
    expect(repo.assessments().map((a) => a.level)).toEqual(['green', 'yellow', 'yellow', 'green']);
    expect(repo.assessments().every((a) => a.recomputed?.level === 'red' && a.inputs?.rulesVersion === RULES_VERSION)).toBe(true);
  });
});
