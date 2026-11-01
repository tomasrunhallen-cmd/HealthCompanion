import type { Assessment } from '../src/core/domain/types';
import { correctionFor, decideSuggestion, saveCorrection } from '../src/services/corrections';
import { startWithStandard } from '../src/services/standard';
import { buildContext } from '../src/core/context/buildContext';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

function assessment(id: string, date: string, signId: string, label = 'Svarar inte på sms'): Assessment {
  return {
    id, entryId: `e_${id}`, date, createdAt: `${date}T20:00:00.000Z`, level: 'yellow', points: 1,
    signals: [{ kind: 'early_sign', points: 1, label, planItemId: signId, quote: 'svarade inte', measured: false }],
    sentence: '', method: 'llm', model: 'm', promptId: 'analys', promptVersion: '1.2.0',
    baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 },
  };
}

async function repoWithSign() {
  const repo = await Repository.create(memoryBackend());
  await repo.addPlanItems([{ id: 'sms', kind: 'early', text: 'Svarar inte på sms' }]);
  return repo;
}

const at = (d: string) => new Date(`${d}T21:00:00`);

describe('corrections', () => {
  it('three alike give exactly one suggestion, and nothing is saved before it is approved', async () => {
    const repo = await repoWithSign();
    const before = JSON.stringify(repo.contextEntries('grund'));
    const days = ['2026-10-28', '2026-10-30', '2026-11-01'];
    const made = [];
    for (const [i, d] of days.entries()) {
      made.push(...await saveCorrection(repo, assessment(`a${i}`, d, 'sms'), { verdict: 'disagree', planItemIds: ['sms'], text: i === 2 ? 'Jag var på jobbresa' : '' }, at(d)));
    }
    expect(made).toHaveLength(1);
    expect(repo.pendingSuggestions()).toHaveLength(1);
    const s = repo.pendingSuggestions()[0];
    expect(s).toMatchObject({ type: 'false_alarm', change: { action: 'add', kind: 'false_alarm', text: 'Svarar inte på sms: Jag var på jobbresa' } });
    expect(s.reason).toContain('inte stämde 3 gånger');
    // Grund is unchanged until approval.
    expect(JSON.stringify(repo.contextEntries('grund'))).toBe(before);

    // A fourth alike correction does not add a second proposal while one is pending.
    await saveCorrection(repo, assessment('a4', '2026-11-02', 'sms'), { verdict: 'disagree', planItemIds: ['sms'], text: '' }, at('2026-11-02'));
    expect(repo.pendingSuggestions()).toHaveLength(1);

    await decideSuggestion(repo, s.id, true, 'Svarar inte på sms när jag är på jobbresa', at('2026-11-03'));
    expect(repo.contextOf('false_alarm')).toEqual([expect.objectContaining({ text: 'Svarar inte på sms när jag är på jobbresa', origin: 'suggested', approvedAt: expect.any(String) })]);
    expect(repo.pendingSuggestions()).toHaveLength(0);
  });

  it('a rejected proposal changes nothing, and only comes back after three new corrections', async () => {
    const repo = await repoWithSign();
    for (const [i, d] of ['2026-10-28', '2026-10-29', '2026-10-30'].entries()) {
      await saveCorrection(repo, assessment(`a${i}`, d, 'sms'), { verdict: 'disagree', planItemIds: ['sms'], text: '' }, at(d));
    }
    await decideSuggestion(repo, repo.pendingSuggestions()[0].id, false, undefined, at('2026-10-31'));
    expect(repo.contextOf('false_alarm')).toEqual([]);
    for (const [i, d] of ['2026-11-01', '2026-11-02'].entries()) {
      await saveCorrection(repo, assessment(`b${i}`, d, 'sms'), { verdict: 'disagree', planItemIds: ['sms'], text: '' }, at(d));
    }
    expect(repo.pendingSuggestions()).toHaveLength(0);
    await saveCorrection(repo, assessment('b3', '2026-11-03', 'sms'), { verdict: 'disagree', planItemIds: ['sms'], text: '' }, at('2026-11-03'));
    expect(repo.pendingSuggestions()).toHaveLength(1);
  });

  it('mixed directions or different signs do not add up', async () => {
    const repo = await repoWithSign();
    await repo.addPlanItems([{ id: 'buy', kind: 'early', text: 'Handlar saker' }]);
    await saveCorrection(repo, assessment('a', '2026-10-28', 'sms'), { verdict: 'disagree', planItemIds: ['sms'], text: '' }, at('2026-10-28'));
    await saveCorrection(repo, assessment('b', '2026-10-29', 'sms'), { verdict: 'agree', planItemIds: ['sms'], text: '' }, at('2026-10-29'));
    await saveCorrection(repo, assessment('c', '2026-10-30', 'buy'), { verdict: 'disagree', planItemIds: ['buy'], text: '' }, at('2026-10-30'));
    expect(repo.suggestions()).toEqual([]);
  });

  it('three times "stämmer" about a standard sign proposes making it the user\'s own', async () => {
    const repo = await Repository.create(memoryBackend());
    await startWithStandard(repo, at('2026-10-20'));
    const sign = repo.plan().find((p) => p.text === 'Sover mindre')!;
    for (const [i, d] of ['2026-10-28', '2026-10-29', '2026-10-30'].entries()) {
      await saveCorrection(repo, assessment(`a${i}`, d, sign.id, sign.text), { verdict: 'agree', planItemIds: [sign.id], text: '' }, at(d));
    }
    const s = repo.pendingSuggestions()[0];
    expect(s).toMatchObject({ type: 'own_sign', change: { action: 'confirm', targetId: sign.id } });
    await decideSuggestion(repo, s.id, true, undefined, at('2026-10-31'));
    expect(repo.plan().find((p) => p.id === sign.id)).toMatchObject({ origin: 'user', approvedAt: expect.any(String) });
  });

  it('saving again replaces the earlier correction of the same assessment, and the model sees it', async () => {
    const repo = await repoWithSign();
    const a = assessment('a', '2026-10-30', 'sms');
    await saveCorrection(repo, a, { verdict: 'agree', planItemIds: [], text: '' }, at('2026-10-30'));
    await saveCorrection(repo, a, { verdict: 'disagree', planItemIds: ['sms'], text: 'bara trött' }, at('2026-10-30'));
    expect(correctionFor(repo, 'a')).toEqual([expect.objectContaining({ text: 'bara trött', correction: { assessmentId: 'a', verdict: 'disagree', planItemId: 'sms' } })]);
    const entry = { id: 'e', date: '2026-11-01', createdAt: at('2026-11-01').toISOString(), kind: 'checkin' as const, transcript: '', mood: 5, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null };
    expect(buildContext({ entries: repo.contextEntries(), entry, history: [] }).variables.rattelser).toContain('stämde inte om tecknet "Svarar inte på sms". "bara trött"');
  });
});
