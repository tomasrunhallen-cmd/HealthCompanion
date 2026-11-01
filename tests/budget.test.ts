// B7: the assessment is shown within 10 seconds. If the model has not answered in time, word
// matching's result is shown first and filled in when the answer comes.

import type { FetchLike } from '../src/adapter/http';
import { assessEntry, wordMatcher } from '../src/core/analysis/assess';
import type { Entry, PlanItem } from '../src/core/domain/types';
import { destinationKey } from '../src/llm/config';
import { ASSESSMENT_BUDGET_MS, GARMIN_BUDGET_MS, saveCheckin } from '../src/services/checkin';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const URL = 'http://localhost:1/v1';
const ANSWER = JSON.stringify({ matches: [], sentence: 'Inget sticker ut.' });

/** A model on the local network that answers after `ms`, or fails. */
function slowModel(ms: number, fail = false): FetchLike {
  return (_url, init) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        if (fail) resolve({ ok: false, status: 500, text: async () => 'fel' });
        else resolve({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: ANSWER } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
      }, ms);
      init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
}

async function repoWithModel(): Promise<Repository> {
  const repo = await Repository.create(memoryBackend());
  await repo.addPlanItems([{ id: 's1', kind: 'early', text: 'Svarar inte på sms' }]);
  await repo.updateLlmConfig({ provider: 'openai-compatible', model: 'lokal', baseUrl: URL, consentFor: destinationKey('openai-compatible', URL) });
  return repo;
}

const input = { transcript: 'Orkade inte svara på sms i dag.', mood: 5, energy: 5, wordsPerMinute: null };
const NOW = new Date(2026, 10, 4, 21);

describe('the budget', () => {
  it('is 10 seconds, with at most 3 for fresh Garmin numbers', () => {
    expect([ASSESSMENT_BUDGET_MS, GARMIN_BUDGET_MS]).toEqual([10_000, 3_000]);
  });

  it('shows the model\'s assessment directly when it answers in time', async () => {
    const repo = await repoWithModel();
    const r = await saveCheckin(repo, input, NOW, { fetch: slowModel(20) }, {}, { budgetMs: 2_000 });
    expect([r.assessment.method, r.assessment.awaitingModel, r.later]).toEqual(['llm', undefined, undefined]);
  });

  it('shows word matching first when the model is late, and fills in the answer under the same id', async () => {
    const repo = await repoWithModel();
    const t0 = Date.now();
    const r = await saveCheckin(repo, input, NOW, { fetch: slowModel(400) }, {}, { budgetMs: 1_150 });
    expect(Date.now() - t0).toBeLessThan(400);
    expect([r.assessment.method, r.assessment.awaitingModel, r.assessment.level]).toEqual(['wordmatch', true, 'yellow']);
    expect(repo.assessmentFor(r.entry.id)?.awaitingModel).toBe(true);
    const filled = await r.later!;
    expect([filled!.id, filled!.method, filled!.awaitingModel]).toEqual([r.assessment.id, 'llm', undefined]);
    expect(repo.assessmentFor(r.entry.id)).toMatchObject({ id: r.assessment.id, method: 'llm' });
    expect(repo.assessments()).toHaveLength(1);
  });

  it('keeps word matching, marked as a fallback, when the late model fails', async () => {
    const repo = await repoWithModel();
    const r = await saveCheckin(repo, input, NOW, { fetch: slowModel(300, true) }, {}, { budgetMs: 1_100 });
    const filled = await r.later!;
    expect([filled!.method, filled!.awaitingModel, filled!.level]).toEqual(['llm_fallback', undefined, 'yellow']);
  });

  it('leaves a newer check-in the same evening alone', async () => {
    const repo = await repoWithModel();
    const r = await saveCheckin(repo, input, NOW, { fetch: slowModel(300) }, {}, { budgetMs: 1_100 });
    const newer = await saveCheckin(repo, { ...input, transcript: 'Vanlig dag.' }, NOW, { fetch: slowModel(1) }, {}, { budgetMs: 2_000 });
    expect(await r.later!).toBeNull();
    expect(repo.assessments().map((a) => a.id)).toEqual([newer.assessment.id]);
  });
});

describe('word matching is fast', () => {
  it('assesses with a 100-row plan and two years of history well within the budget', async () => {
    const plan: PlanItem[] = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, kind: i % 5 ? 'early' : 'serious', text: `Tecken nummer ${i} med några ord om sömn och sms`, order: i, approvedAt: '2026-01-01' }));
    const history = Array.from({ length: 730 }, (_, i) => {
      const d = new Date(2024, 10, 4 + i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const entry: Entry = { id: `h${i}`, date, createdAt: `${date}T20:00:00.000Z`, localTime: '21:00', kind: 'checkin', transcript: 'Vanlig dag med jobb och middag.', mood: 5, energy: 5, wordsPerMinute: null, sleepHours: 7, sleepSource: 'garmin', stressAvg: 30 };
      return { entry, level: 'green' as const };
    });
    const t0 = Date.now();
    const a = await assessEntry({ entry: { ...history[0].entry, id: 'today', date: '2026-11-04', createdAt: '2026-11-04T20:00:00.000Z', transcript: 'Orkade inte svara på sms. Tecken nummer 7 med några ord om sömn och sms.' }, plan, planSettings: { normalState: '', sleepThresholdHours: 5 }, history, matcher: wordMatcher });
    // A four-year-old phone is several times slower than a test machine; this leaves room for that.
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(a.level).not.toBe('green');
  });
});
