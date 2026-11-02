import { explainAssessment } from '../src/core/analysis/explain';
import { score } from '../src/core/analysis/scoring';
import type { Entry } from '../src/core/domain/types';
import { saveCheckin } from '../src/services/checkin';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const PS = { normalState: '', sleepThresholdHours: 5 };
const entry: Entry = {
  id: 'e', date: '2026-11-04', createdAt: new Date(2026, 10, 4, 21).toISOString(), kind: 'checkin', transcript: '',
  mood: 0, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null,
};
const kinds = (medication: Record<string, boolean>) =>
  score({ entry, matches: [], plan: [], planSettings: PS, history: [], medication }).signals.filter((s) => s.kind === 'medication_missed');

describe('medication in the score', () => {
  it('missed two days in a row gives exactly 1 point', () => {
    const r = score({ entry, matches: [], plan: [], planSettings: PS, history: [], medication: { '2026-11-03': false, '2026-11-04': false } });
    expect(r.signals).toEqual([expect.objectContaining({ kind: 'medication_missed', points: 1, label: 'Medicin inte tagen i går och i dag' })]);
    expect(r.points).toBe(1);
    expect(r.level).toBe('yellow');
  });

  it('one missed day, a yes, or no answer gives nothing', () => {
    expect(kinds({ '2026-11-04': false })).toEqual([]);
    expect(kinds({ '2026-11-03': true, '2026-11-04': false })).toEqual([]);
    expect(kinds({ '2026-11-03': false, '2026-11-04': true })).toEqual([]);
    expect(kinds({ '2026-11-02': false, '2026-11-04': false })).toEqual([]);
  });

  it('works through the check-in and shows under the signs that scored', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addContextEntry({ kind: 'medication', text: 'Litium 600 mg', origin: 'user' });
    await saveCheckin(repo, { transcript: 'Glömde medicinen.', mood: 0, energy: 5, wordsPerMinute: null, medicationTaken: false }, new Date(2026, 10, 3, 21));
    const { entry: e, assessment } = await saveCheckin(repo, { transcript: 'Glömde igen.', mood: 0, energy: 5, wordsPerMinute: null, medicationTaken: false }, new Date(2026, 10, 4, 21));
    expect(assessment.signals.filter((s) => s.kind === 'medication_missed')).toHaveLength(1);
    expect(assessment.points).toBe(1);
    expect(explainAssessment(e, assessment, null).signs).toContainEqual({ label: 'Medicin inte tagen i går och i dag', points: 1 });
  });
});
