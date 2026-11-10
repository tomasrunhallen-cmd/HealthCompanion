// The app cannot make the watch sync; Garmin Connect on the phone does. When today's values lag,
// coming back to the app fetches again after five minutes instead of half an hour.

import type { GarminDay } from '../src/core/domain/types';
import { syncOnOpen, watchLags } from '../src/services/garmin';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

jest.mock('../src/platform/secrets', () => ({ secretsPersist: false, getSecret: async () => null, setSecret: async () => undefined, deleteSecret: async () => undefined }));

const day = (date: string, dataUntil: string | null): GarminDay => ({
  date, sleepHours: 7, deepMinutes: null, remMinutes: null, sleepStart: null, sleepEnd: null, stressAvg: 30,
  stressHighMinutes: null, bodyBatteryWake: null, fetchedAt: '', ...(dataUntil ? { dataUntil } : {}),
});

describe('Klockan ligger efter', () => {
  it('lags with no values today, or with the last reading two hours or more ago', async () => {
    const repo = await Repository.create(memoryBackend());
    const at = (h: number, m = 0) => new Date(2026, 10, 10, h, m);
    expect(watchLags(repo, at(19))).toBe(true);
    await repo.saveGarminDays([day('2026-11-10', '18:10')], '2026-11-10');
    expect(watchLags(repo, at(19))).toBe(false);
    expect(watchLags(repo, at(20, 9))).toBe(false);
    expect(watchLags(repo, at(20, 10))).toBe(true);
    // After midnight the evening goes on: 01:00 is seven hours after 18:10.
    expect(watchLags(repo, new Date(2026, 10, 11, 1, 0))).toBe(true);
  });

  it('fetches again on coming back after five minutes while lagging, otherwise after half an hour', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.saveGarminDays([day('2026-11-10', '14:00')], '2026-11-10');
    await repo.updateGarminStatus({ connected: true, lastSyncAt: new Date(2026, 10, 10, 19, 0).toISOString(), lastError: null });
    // Lagging (14:00 at 19:06): asks again after five minutes. It gets as far as the missing key.
    expect(await syncOnOpen(repo, { now: new Date(2026, 10, 10, 19, 4) })).toBeNull();
    expect(await syncOnOpen(repo, { now: new Date(2026, 10, 10, 19, 6) })).not.toBeNull();
    // Current: half an hour.
    await repo.saveGarminDays([day('2026-11-10', '18:55')], '2026-11-10');
    await repo.updateGarminStatus({ lastSyncAt: new Date(2026, 10, 10, 19, 0).toISOString(), lastError: null });
    expect(await syncOnOpen(repo, { now: new Date(2026, 10, 10, 19, 20) })).toBeNull();
    expect(await syncOnOpen(repo, { now: new Date(2026, 10, 10, 19, 31) })).not.toBeNull();
  });
});
