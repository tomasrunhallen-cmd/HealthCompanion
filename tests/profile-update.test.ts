import { fixedAdapter } from '../src/core/llm/fake';
import type { Assessment, Entry } from '../src/core/domain/types';
import { decideSuggestion } from '../src/services/corrections';
import { courseOfPeriod, endedPeriods, profileUpdateDue, suggestionsFromAnswer } from '../src/core/context/profileUpdate';
import { destinationKey } from '../src/llm/config';
import { setSecret } from '../src/platform/secrets';
import { LLM_KEY_NAME } from '../src/services/llm';
import { runProfileReview } from '../src/services/profile';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import type { FetchLike } from '../src/adapter/http';

jest.mock('../src/platform/secrets', () => {
  const mem = new Map<string, string>();
  return {
    secretsPersist: false,
    getSecret: async (n: string) => mem.get(n) ?? null,
    setSecret: async (n: string, v: string) => void mem.set(n, v),
    deleteSecret: async (n: string) => void mem.delete(n),
  };
});

function a(date: string, level: Assessment['level'], signIds: string[] = [], over: Partial<Assessment> = {}): Assessment {
  return {
    id: `a_${date}`, entryId: `e_${date}`, date, createdAt: `${date}T20:00:00.000Z`, level, points: signIds.length,
    signals: signIds.map((id) => ({ kind: 'early_sign', points: 1, label: id, planItemId: id, measured: false })),
    sentence: '', method: 'wordmatch', model: null, promptId: null, promptVersion: null,
    baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 }, ...over,
  };
}

function e(date: string, transcript: string): Entry {
  return { id: `e_${date}`, date, createdAt: `${date}T20:00:00.000Z`, kind: 'checkin', transcript, mood: 0, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null };
}

const PERIOD = [
  a('2026-10-10', 'green'),
  a('2026-10-11', 'yellow', ['sleep']),
  a('2026-10-12', 'yellow', ['sleep']),
  a('2026-10-13', 'yellow', ['ideas']),
  a('2026-10-14', 'red', ['ideas', 'withdraw']),
  a('2026-10-15', 'green'),
];

describe('when a review is due', () => {
  it('finds a period of more than three days with yellow or red that is over', () => {
    expect(endedPeriods(PERIOD, '2026-10-20')).toEqual([{ from: '2026-10-11', to: '2026-10-14' }]);
    expect(endedPeriods(PERIOD.slice(0, 4), '2026-10-13')).toEqual([]); // three days, still going
    expect(endedPeriods([a('2026-10-11', 'yellow'), a('2026-10-12', 'yellow'), a('2026-10-13', 'yellow'), a('2026-10-15', 'green')], '2026-10-20')).toEqual([]);
  });

  it('is due after a period, then once a month', () => {
    const now = new Date(2026, 9, 16, 21);
    expect(profileUpdateDue({ lastRunAt: null, lastPeriodEnd: null }, PERIOD, now, '2026-10-16')).toEqual({ reason: 'period', period: { from: '2026-10-11', to: '2026-10-14' } });
    expect(profileUpdateDue({ lastRunAt: '2026-10-16T21:00:00Z', lastPeriodEnd: '2026-10-14' }, PERIOD, now, '2026-10-16')).toBeNull();
    expect(profileUpdateDue({ lastRunAt: '2026-10-16T21:00:00Z', lastPeriodEnd: '2026-10-14' }, PERIOD, now, '2026-11-15')).toMatchObject({ reason: 'monthly' });
  });
});

describe('course of a period', () => {
  it('names the first sign and the days between, in code', () => {
    const plan = [
      { id: 'sleep', kind: 'early' as const, text: 'Sover mindre', order: 0, approvedAt: 'x' },
      { id: 'ideas', kind: 'early' as const, text: 'Många nya idéer', order: 1, approvedAt: 'x' },
      { id: 'withdraw', kind: 'early' as const, text: 'Drar mig undan', order: 2, approvedAt: 'x' },
    ];
    expect(courseOfPeriod({ from: '2026-10-11', to: '2026-10-14' }, PERIOD, plan)).toBe(
      'Perioden söndag 11 oktober till onsdag 14 oktober: först ”Sover mindre”, 2 dagar senare ”Många nya idéer”, 1 dag senare ”Drar mig undan”.',
    );
    expect(courseOfPeriod({ from: '2026-10-11', to: '2026-10-12' }, PERIOD, plan)).toBeNull();
  });
});

describe('profile proposals from the model', () => {
  const input = {
    reason: 'x', normalState: 'Sover sju timmar', signs: [], names: [],
    profile: [{ id: 'p1', layer: 'profil' as const, kind: 'typical_phrase' as const, text: 'Lugn dag', order: 0, origin: 'user' as const, createdAt: '', approvedAt: '' }],
    notes: [],
  };
  const notes = '- 12 okt (gult): Sov fyra timmar och startade tre projekt\n- 13 okt (gult): Allt går så fort';

  it('keeps only changes with a real quote, no diagnosis words, and existing targets', () => {
    const out = suggestionsFromAnswer({ changes: [
      { action: 'add', kind: 'period-uppvarvad', target: 0, text: 'Oktober: sov lite och startade många projekt', reason: 'Syns i anteckningarna', quotes: ['startade tre projekt'] },
      { action: 'add', kind: 'period-uppvarvad', target: 0, text: 'Hittat på', reason: 'r', quotes: ['finns inte i texten'] },
      { action: 'add', kind: 'period-uppvarvad', target: 0, text: 'En manisk episod', reason: 'r', quotes: ['Allt går så fort'] },
      { action: 'update', kind: 'typisk-formulering', target: 9, text: 'x', reason: 'r', quotes: ['Allt går så fort'] },
      { action: 'remove', kind: 'typisk-formulering', target: 1, text: '', reason: 'Stämmer inte längre', quotes: ['Allt går så fort'] },
    ] }, input, notes, new Date());
    expect(out.map((s) => [s.change.action, s.change.kind, s.change.text, s.change.targetId])).toEqual([
      ['add', 'period_high', 'Oktober: sov lite och startade många projekt', null],
      ['remove', 'typical_phrase', 'Lugn dag', 'p1'],
    ]);
    expect(out.every((s) => s.status === 'pending' && s.source === 'profile_update')).toBe(true);
  });
});

describe('running a review', () => {
  it('sends scrubbed notes without emergency notes, and changes nothing until approved', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addPlanItems([
      { id: 'sleep', kind: 'early', text: 'Sover mindre' },
      { id: 'ideas', kind: 'early', text: 'Många nya idéer' },
    ]);
    await repo.updateSettings({ scrubNames: ['Kim'] });
    await repo.updateLlmConfig({ provider: 'mistral', model: 'm', consentFor: destinationKey('mistral', '') });
    await setSecret(LLM_KEY_NAME, 'k');
    const days = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];
    for (const [i, d] of days.entries()) {
      const note = i === 3 ? 'Jag vill inte leva.' : `Sov fyra timmar, ringde Kim och startade tre projekt dag ${i}`;
      await repo.saveEntry(e(d, note), a(d, i === 3 ? 'red' : 'yellow', i < 2 ? ['sleep'] : ['ideas'], i === 3 ? { akut: true } : {}));
    }
    await repo.saveEntry(e('2026-10-15', 'Lugn dag.'), a('2026-10-15', 'green'));

    const sent: string[] = [];
    const llm: FetchLike = async (_u, init) => {
      sent.push(JSON.parse(init.body).messages[1].content);
      const content = JSON.stringify({ changes: [{ action: 'add', kind: 'period-uppvarvad', target: 0, text: 'Oktober: sov fyra timmar och startade projekt', reason: 'Tre dagar i rad', quotes: ['startade tre projekt'] }] });
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
    };
    const before = JSON.stringify(repo.contextEntries());
    const res = await runProfileReview(repo, { reason: 'period', period: { from: '2026-10-11', to: '2026-10-14' } }, { fetch: llm, at: new Date(2026, 9, 16, 21) });
    expect(res).toEqual({ made: 2, usedModel: true, error: null });
    expect(sent[0]).toContain('ringde [NAMN]');
    expect(sent[0]).not.toContain('Kim');
    expect(sent[0]).not.toContain('vill inte leva');
    expect(JSON.stringify(repo.contextEntries())).toBe(before);

    const [course, profile] = repo.pendingSuggestions();
    expect(course).toMatchObject({ type: 'course', change: { kind: 'course' } });
    expect(course.change.text).toContain('först ”Sover mindre”, 2 dagar senare ”Många nya idéer”');
    expect(profile).toMatchObject({ type: 'profile', change: { kind: 'period_high' }, quotes: ['startade tre projekt'] });

    await decideSuggestion(repo, course.id, true);
    await decideSuggestion(repo, profile.id, false);
    expect(repo.contextEntries('profil').map((x) => [x.kind, x.origin])).toEqual([['course', 'suggested']]);
  });

  it('without a language model it still proposes the course', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addPlanItems([{ id: 'sleep', kind: 'early', text: 'Sover mindre' }, { id: 'ideas', kind: 'early', text: 'Många nya idéer' }]);
    for (const x of PERIOD) await repo.saveEntry(e(x.date, 'text'), x);
    const res = await runProfileReview(repo, { reason: 'period', period: { from: '2026-10-11', to: '2026-10-14' } });
    expect(res).toEqual({ made: 1, usedModel: false, error: null });
  });
});
