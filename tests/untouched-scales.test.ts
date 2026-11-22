// An untouched slider is no answer: it is saved as missing, never as "Balanserad" or energy 5.
import { saveCheckin } from '../src/services/checkin';
import { ratingsOf } from '../src/services/moodPatterns';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const NOW = new Date('2026-11-22T20:00:00');

it('saves untouched mood and energy as missing, and Mina mönster does not count them', async () => {
  const repo = await Repository.create(memoryBackend());
  const { entry, assessment } = await saveCheckin(repo, { transcript: 'En vanlig dag.', mood: null, energy: null, wordsPerMinute: null }, NOW);
  expect(entry.mood).toBeNull();
  expect(entry.energy).toBeNull();
  expect(assessment.signals.some((s) => s.kind.startsWith('mood'))).toBe(false);
  expect(Object.keys(ratingsOf(repo))).toHaveLength(0);
});

it('keeps a middle value the person chose', async () => {
  const repo = await Repository.create(memoryBackend());
  const { entry } = await saveCheckin(repo, { transcript: 'En vanlig dag.', mood: 0, energy: 5, wordsPerMinute: null }, NOW);
  expect([entry.mood, entry.energy]).toEqual([0, 5]);
  expect(Object.values(ratingsOf(repo))).toEqual([0]);
});
