import { minutesBehind, wasStale } from '../src/core/analysis/remeasure';
import { mergeDays } from '../src/garmin/client';
import { saveCheckin } from '../src/services/checkin';
import { afterSync, applyRemeasure, forgetKept, keepAsItWas, remeasureEntry, remeasurePending } from '../src/services/remeasure';
import type { GarminDay } from '../src/core/domain/types';
import { at, note, repoWithPlan } from './helpers/plan';

jest.mock('../src/platform/reminder', () => ({ notifyNow: async () => false }));

const day = (date: string, v: Partial<GarminDay>): GarminDay => ({
  date, sleepHours: null, deepMinutes: null, remMinutes: null, sleepStart: null, sleepEnd: null,
  stressAvg: null, stressHighMinutes: null, bodyBatteryWake: null, fetchedAt: `${date}T12:00:00Z`, ...v,
});

describe('Klockan synkade sent', () => {
  it('counts how far behind the watch is, also after midnight', () => {
    expect(minutesBehind('12:40', '19:00')).toBe(380);
    expect(minutesBehind('23:30', '01:00')).toBe(90);
    expect(minutesBehind('18:50', '19:00')).toBe(10);
    expect(minutesBehind(null, '19:00')).toBeNull();
  });

  it('takes the last Body Battery reading as how far the watch has synced', () => {
    const ms = (h: number, m: number) => new Date(2026, 10, 3, h, m).getTime();
    const [d] = mergeDays([], [{ date: '2026-11-03', stressAvg: 40, stressHighMinutes: 10 }], [{ date: '2026-11-03', values: [[ms(7, 0), 80], [ms(12, 40), 55], [ms(9, 0), 70]] }], 'x');
    expect(d.dataUntil).toBe('12:40');
  });

  it('saves how far the watch had synced with the check-in', async () => {
    const repo = await repoWithPlan();
    await repo.saveGarminDays([day('2026-11-03', { stressAvg: 30, dataUntil: '12:40' })], '2026-11-03');
    const { entry } = await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-03', '19:30'));
    expect(entry.measuredUntil).toBe('12:40');
    expect(wasStale(entry)).toBe(true);
  });

  it('asks before a later sync changes the level, and keeps the signs from the note', async () => {
    const repo = await repoWithPlan();
    await repo.saveGarminDays([day('2026-11-03', { stressAvg: 30, dataUntil: '06:10' })], '2026-11-03');
    const { entry, assessment } = await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-03', '19:30'));
    expect(assessment.level).toBe('green');

    // The night's sleep comes in the next morning: four and a half hours.
    await repo.saveGarminDays([day('2026-11-03', { sleepHours: 4.5, stressAvg: 30, dataUntil: '23:50' })], '2026-11-04');
    const ask = await afterSync(repo, at('2026-11-04', '08:00'));
    expect(ask).toHaveLength(1);
    expect(ask[0].before.level).toBe('green');
    expect(ask[0].after.level).toBe('yellow');
    expect(ask[0].changes).toEqual(['Sömn 4,5 h (saknades)']);
    // Nothing saved yet.
    expect(repo.assessmentFor(entry.id)!.level).toBe('green');
    expect(remeasurePending(repo, at('2026-11-04', '08:00'))).toHaveLength(1);

    await applyRemeasure(repo, ask[0]);
    const a = repo.assessmentFor(entry.id)!;
    expect(a.level).toBe('yellow');
    expect(a.remeasured).toMatchObject({ level: 'green', changes: ['Sömn 4,5 h (saknades)'] });
    expect(a.sentence).toMatch(/sömn 4,5 h/);
    expect(repo.entries().find((e) => e.id === entry.id)!.sleepHours).toBe(4.5);
    expect(remeasurePending(repo, at('2026-11-04', '08:00'))).toHaveLength(0);
  });

  it('keeps the day as it was until the values change again', async () => {
    const repo = await repoWithPlan();
    await repo.saveGarminDays([day('2026-11-03', { stressAvg: 30, dataUntil: '06:10' })], '2026-11-03');
    const { entry } = await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-03', '19:30'));
    await repo.saveGarminDays([day('2026-11-03', { sleepHours: 4.5, stressAvg: 30, dataUntil: '23:50' })], '2026-11-04');
    const [r] = await afterSync(repo, at('2026-11-04', '08:00'));
    await keepAsItWas(repo, r);
    expect(await afterSync(repo, at('2026-11-04', '09:00'))).toHaveLength(0);
    expect(repo.assessmentFor(entry.id)!.level).toBe('green');
    // Asked again on the day: shown again.
    await forgetKept(repo, entry.id);
    expect(remeasurePending(repo, at('2026-11-04', '09:00'))).toHaveLength(1);
  });

  it('updates the values at once when the level and points stay', async () => {
    const repo = await repoWithPlan();
    await repo.saveGarminDays([day('2026-11-03', { sleepHours: 7.5, stressAvg: 30, dataUntil: '12:40' })], '2026-11-03');
    const { entry } = await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-03', '19:30'));
    await repo.saveGarminDays([day('2026-11-03', { sleepHours: 7.5, stressAvg: 34, dataUntil: '23:50' })], '2026-11-04');
    expect(await afterSync(repo, at('2026-11-04', '08:00'))).toHaveLength(0);
    const e = repo.entries().find((x) => x.id === entry.id)!;
    expect(e.stressAvg).toBe(34);
    expect(e.measuredUntil).toBe('23:50');
    expect(repo.assessmentFor(entry.id)!.level).toBe('green');
  });

  it('leaves a check-in made while the watch was in sync', async () => {
    const repo = await repoWithPlan();
    await repo.saveGarminDays([day('2026-11-03', { sleepHours: 7.5, stressAvg: 30, dataUntil: '19:10' })], '2026-11-03');
    const { entry } = await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-03', '19:30'));
    await repo.saveGarminDays([day('2026-11-03', { sleepHours: 7.5, stressAvg: 36, dataUntil: '23:50' })], '2026-11-04');
    expect(await afterSync(repo, at('2026-11-04', '08:00'))).toHaveLength(0);
    expect(repo.entries().find((x) => x.id === entry.id)!.stressAvg).toBe(30);
    // Asked for on the day itself, the difference is still there to see.
    expect(remeasureEntry(repo, entry.id, at('2026-11-04', '08:00'))!.changes).toEqual(['Stress 36 (förut 30)']);
  });

  it('never replaces what the person entered', async () => {
    const repo = await repoWithPlan();
    await repo.saveGarminDays([day('2026-11-03', { stressAvg: 30, dataUntil: '06:10' })], '2026-11-03');
    const { entry } = await saveCheckin(repo, { ...note('Vanlig dag.'), manualSleepHours: 7 }, at('2026-11-03', '19:30'));
    await repo.saveGarminDays([day('2026-11-03', { sleepHours: 4.5, stressAvg: 30, dataUntil: '23:50' })], '2026-11-04');
    expect(remeasureEntry(repo, entry.id, at('2026-11-04', '08:00'))).toBeNull();
  });
});
