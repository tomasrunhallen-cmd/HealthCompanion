// B5: sleep and stress from Garmin, Apple Hälsa/Health Connect and the person's own entry,
// in one format, merged field by field, and the assessment says which source was used.

import { explainAssessment } from '../src/core/analysis/explain';
import { computeBaseline } from '../src/core/analysis/scoring';
import { MANUAL_STRESS, mergeSources, sleepSourceOf, stressSourceOf } from '../src/core/analysis/sources';
import type { Entry, MeasuredDay } from '../src/core/domain/types';
import { saveCheckin } from '../src/services/checkin';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const day = (date: string, over: Partial<MeasuredDay>): MeasuredDay => ({
  date, sleepHours: null, deepMinutes: null, remMinutes: null, sleepStart: null, sleepEnd: null,
  stressAvg: null, stressHighMinutes: null, bodyBatteryWake: null, fetchedAt: '', ...over,
});

describe('merging the sources', () => {
  it('takes the own entry first, then Garmin, then the health app, sleep and stress each on their own', () => {
    const d = '2026-11-04';
    const merged = mergeSources({
      garmin: { [d]: day(d, { sleepHours: 6.5, sleepStart: '23:40', stressAvg: 38 }) },
      health: { [d]: day(d, { sleepHours: 7, stressAvg: 20, source: 'health' }) },
      manual: { [d]: day(d, { stressAvg: MANUAL_STRESS.high, source: 'manual' }) },
    })[d];
    expect([merged.sleepHours, merged.sleepStart, sleepSourceOf(merged)]).toEqual([6.5, '23:40', 'garmin']);
    expect([merged.stressAvg, stressSourceOf(merged)]).toEqual([75, 'manual']);
    const onlyHealth = mergeSources({ health: { [d]: day(d, { sleepHours: 7, source: 'health' }) } })[d];
    expect([sleepSourceOf(onlyHealth), stressSourceOf(onlyHealth)]).toEqual(['health', null]);
  });

  it('treats days saved before sources existed as Garmin', () => {
    expect(sleepSourceOf(day('2026-11-04', { sleepHours: 7 }))).toBe('garmin');
  });
});

describe('the check-in', () => {
  it('saves the own entry, uses it before Garmin, and the assessment names the source', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.saveGarminDays([day('2026-11-04', { sleepHours: 7.5, stressAvg: 30 })], '2026-11-04');
    const { entry, assessment } = await saveCheckin(repo, { transcript: 'Vanlig dag.', mood: 5, energy: 5, wordsPerMinute: null, manualSleepHours: 4.5, manualStress: null }, new Date(2026, 10, 4, 21));
    expect([entry.sleepHours, entry.sleepSource, entry.stressAvg, entry.stressSource]).toEqual([4.5, 'manual', 30, 'garmin']);
    expect(repo.manualDays()['2026-11-04']).toMatchObject({ sleepHours: 4.5, source: 'manual' });
    expect(assessment.signals.find((s) => s.kind === 'sleep_low')).toBeTruthy();
    const lines = explainAssessment(entry, assessment, repo.measuredDay('2026-11-04')).data;
    expect(lines).toContain('Sömn 4,5 h som du själv angav');
    expect(lines.find((l) => l.startsWith('Stress 30'))).not.toContain('som du själv angav');
  });
});

describe('stress baselines per source', () => {
  it('compares stress only with stress from the same source', () => {
    const e = (date: string, stressAvg: number, stressSource?: 'manual' | 'garmin'): Entry => ({
      id: date, date, createdAt: `${date}T21:00:00Z`, localTime: '21:00', kind: 'checkin', transcript: '', mood: 5, energy: 5,
      wordsPerMinute: null, sleepHours: 7.5, sleepSource: 'garmin', stressAvg, ...(stressSource ? { stressSource } : {}),
    });
    const history = [
      ...['2026-10-20', '2026-10-21', '2026-10-22'].map((d) => ({ entry: e(d, 30), level: 'green' as const })),
      ...['2026-10-23', '2026-10-24', '2026-10-25'].map((d) => ({ entry: e(d, 50, 'manual'), level: 'green' as const })),
    ];
    expect(computeBaseline('2026-11-04', history, 'garmin').stressAvg).toBe(30);
    expect(computeBaseline('2026-11-04', history, 'manual').stressAvg).toBe(50);
    expect(computeBaseline('2026-11-04', history, 'health').stressAvg).toBeNull();
  });
});
