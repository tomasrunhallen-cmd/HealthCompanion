// Mina mönster on the phone: the monthly run, the hypotheses, the card on Hem, and the optional
// explanation from a language model, which gets only counts and is checked against them.
import type { FetchLike } from '../src/adapter/http';
import { addDays } from '../src/core/analysis/dates';
import { simulate, simulateRatings, type SimEvent } from '../src/core/analysis/rhythmSim';
import type { Assessment, Entry } from '../src/core/domain/types';
import { destinationKey } from '../src/llm/config';
import { setSecret } from '../src/platform/secrets';
import { LLM_KEY_NAME } from '../src/services/llm';
import {
  ensureMonthlyPatterns, explainFindings, markPatternsSeen, outgoingFacts, patternCard, patternStore, ratingsOf, runPatterns, setPatternExplanations, shownFindings,
} from '../src/services/moodPatterns';
import { ACTIVITY_KEY } from '../src/services/rhythm';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

jest.mock('../src/platform/secrets', () => {
  const mem = new Map<string, string>();
  return { secretsPersist: false, getSecret: async (n: string) => mem.get(n) ?? null, setSecret: async (n: string, v: string) => void mem.set(n, v), deleteSecret: async (n: string) => void mem.delete(n) };
});

const END = '2026-11-13';
const NOW = new Date(`${END}T09:00:00`);
const d = (n: number) => addDays(END, -n);
const up = (n: number): SimEvent => ({ kind: 'episode', start: d(n), type: 'up', days: 14 });

function entry(date: string, mood: number, transcript = ''): Entry {
  return { id: `e_${date}`, date, createdAt: `${date}T20:00:00.000Z`, kind: 'checkin', transcript, mood, energy: null, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null };
}
const assessment = (e: Entry): Assessment => ({ id: `a_${e.id}`, entryId: e.id, date: e.date, level: 'green', points: 0, signals: [] } as unknown as Assessment);

async function repoWith(events: SimEvent[], days = 400, until = END) {
  const repo = await Repository.create(memoryBackend());
  const data = simulate({ end: END, days, seed: 5, events });
  const ratings = simulateRatings({ end: END, days, seed: 5, events });
  await repo.saveGarminDays(Object.values(data.measured).filter((m) => m.date <= until), until);
  await repo.kvSet(ACTIVITY_KEY, Object.fromEntries(Object.entries(data.activity).filter(([k]) => k <= until)));
  for (const [date, mood] of Object.entries(ratings)) {
    if (date > until) continue;
    const e = entry(date, mood, 'Min anteckning om dagen hos Kim på Mottagning Exempel.');
    await repo.saveEntry(e, assessment(e));
  }
  return { repo, data, ratings };
}

async function withModel(repo: Repository) {
  await repo.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest', consentFor: destinationKey('mistral', '') });
  await setSecret(LLM_KEY_NAME, 'mk');
}

describe('the monthly analysis', () => {
  it('reads the ratings that are saved, and a day without one is missing', async () => {
    const { repo, ratings } = await repoWith([up(60)], 90);
    expect(ratingsOf(repo)).toEqual(ratings);
    expect(Object.keys(ratingsOf(repo)).length).toBeLessThan(90);
  });

  it('runs by itself when it is due, keeps a finding as a hypothesis and shows a card on Hem until it is opened', async () => {
    const { repo } = await repoWith([up(330), up(240), up(150), up(60)]);
    expect(patternStore(repo).analysis).toBeNull();
    await ensureMonthlyPatterns(repo, NOW);
    const s = patternStore(repo);
    expect(s.analysis?.status).toBe('found');
    expect(s.hypotheses.map((h) => h.candidateId)).toContain('shorter_up');
    expect(s.hypotheses[0]).toMatchObject({ dataThrough: END });
    const shown = shownFindings(repo);
    expect(shown.length).toBeGreaterThanOrEqual(1);
    expect(shown.length).toBeLessThanOrEqual(2);
    expect(shown[0].later).toEqual({ periods: 0, hits: 0, patternOnly: 0 });
    const card = patternCard(repo)!;
    expect(card.id).toMatch(/^pattern_/);
    await markPatternsSeen(repo);
    expect(patternCard(repo)).toBeNull();
  });

  it('is not made again within a month, and is made again after one', async () => {
    const { repo } = await repoWith([up(330), up(240), up(150), up(60)]);
    await ensureMonthlyPatterns(repo, NOW);
    const first = patternStore(repo).analysis!.computedAt;
    await ensureMonthlyPatterns(repo, new Date(NOW.getTime() + 20 * 864e5));
    expect(patternStore(repo).analysis!.computedAt).toBe(first);
    await ensureMonthlyPatterns(repo, new Date(NOW.getTime() + 31 * 864e5));
    expect(patternStore(repo).analysis!.computedAt).not.toBe(first);
    // The hypothesis keeps the day and the numbers it was found with.
    expect(patternStore(repo).hypotheses.find((h) => h.candidateId === 'shorter_up')).toMatchObject({ dataThrough: END, foundAt: first });
  });

  it('does not run by itself with too little saved, and says so when asked', async () => {
    const { repo } = await repoWith([], 20);
    await ensureMonthlyPatterns(repo, NOW);
    expect(patternStore(repo).analysis).toBeNull();
    const a = await runPatterns(repo, NOW);
    expect(a.status).toBe('insufficient');
    expect(shownFindings(repo)).toEqual([]);
    expect(patternCard(repo)).toBeNull();
  });

  it('a hypothesis is tried on periods that come after the day it was found', async () => {
    // Uneven gaps: periods exactly as far apart would line up again in the shift test.
    const events = [up(330), up(255), up(150), up(60)];
    const { repo, data, ratings } = await repoWith(events, 400, d(100));
    await runPatterns(repo, new Date(`${d(100)}T09:00:00`));
    expect(shownFindings(repo)[0].later.periods).toBe(0);
    // Time passes: the rest of the nights and ratings are saved.
    await repo.saveGarminDays(Object.values(data.measured).filter((m) => m.date > d(100)), END);
    await repo.kvSet(ACTIVITY_KEY, data.activity);
    for (const [date, mood] of Object.entries(ratings)) if (date > d(100)) { const e = entry(date, mood); await repo.saveEntry(e, assessment(e)); }
    await runPatterns(repo, NOW);
    const f = shownFindings(repo).find((x) => x.hypothesis.candidateId === 'shorter_up')!;
    expect(f.hypothesis.dataThrough).toBe(d(100));
    expect(f.hypothesis.found).toMatchObject({ periods: 3, hits: 3 });
    expect(f.later).toMatchObject({ periods: 1, hits: 1 });
  });
});

describe('the explanation from a language model', () => {
  const good = { text: 'Alla 4 gånger du skattade högre stämningsläge hade sömnen blivit kortare dagarna innan.' };

  it('is off until the person turns it on, and then sends only counts: no dates and no notes', async () => {
    const { repo } = await repoWith([up(330), up(240), up(150), up(60)]);
    await withModel(repo);
    const sent: string[] = [];
    const fetch: FetchLike = async (_u, init) => {
      sent.push(JSON.parse(init.body).messages[1].content);
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] }) };
    };
    await runPatterns(repo, NOW, { fetch });
    expect(sent).toHaveLength(0);
    expect(await explainFindings(repo, { fetch })).toEqual({ made: 0, dropped: 0 });
    const preview = outgoingFacts(repo);
    expect(preview.length).toBeGreaterThanOrEqual(1);

    await setPatternExplanations(repo, true, { fetch });
    expect(sent.length).toBe(preview.length);
    for (const s of sent) {
      expect(preview.some((p) => s.includes(p.sent))).toBe(true);
      expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(s).not.toMatch(/anteckning om dagen|Kim|Mottagning Exempel/);
    }
    const shown = shownFindings(repo);
    expect(shown[0].explanation).toMatchObject({ text: good.text, model: 'mistral-small-latest', promptVersion: '1.0.0' });
    // Written once: the same numbers are not sent again.
    const before = sent.length;
    await explainFindings(repo, { fetch });
    expect(sent.length).toBe(before);
  });

  it('drops an answer with a number that is not in the facts, a diagnosis or a cause, and shows nothing in its place', async () => {
    for (const bad of ['Det hände 17 gånger.', 'Kort sömn kom före dina maniska episoder.', 'Kort sömn orsakar högre stämningsläge.']) {
      const { repo } = await repoWith([up(330), up(240), up(150), up(60)]);
      await withModel(repo);
      const fetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: bad }) } }] }) });
      await runPatterns(repo, NOW, { fetch });
      await setPatternExplanations(repo, true, { fetch });
      expect(shownFindings(repo).every((f) => f.explanation === null)).toBe(true);
      // The finding itself, counted by the code, is still shown.
      expect(shownFindings(repo).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('a model that fails leaves the finding as the code worded it', async () => {
    const { repo } = await repoWith([up(330), up(240), up(150), up(60)]);
    await withModel(repo);
    const fetch: FetchLike = async () => { throw new Error('offline'); };
    await runPatterns(repo, NOW, { fetch });
    await setPatternExplanations(repo, true, { fetch });
    expect(shownFindings(repo)[0].explanation).toBeNull();
  });

  it('an explanation is shown only while the numbers it was written from stand', async () => {
    const { repo } = await repoWith([up(330), up(240), up(150), up(60)]);
    await withModel(repo);
    const fetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] }) });
    await runPatterns(repo, NOW, { fetch });
    await setPatternExplanations(repo, true, { fetch });
    expect(shownFindings(repo)[0].explanation).not.toBeNull();
    const s = patternStore(repo);
    const id = shownFindings(repo)[0].hypothesis.candidateId;
    await repo.kvSet('moodPatterns', { ...s, explanations: { [id]: { ...s.explanations[id], facts: 'andra siffror' } } });
    expect(shownFindings(repo)[0].explanation).toBeNull();
  });
});
