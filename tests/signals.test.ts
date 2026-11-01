// C6 Kontroll över signaler: quiet hours hold back the app's own notices, proposals show
// directly, on Mondays or only before a visit, and the low mode is a setting the person controls.

import { addDays } from '../src/core/analysis/dates';
import { inQuietHours, suggestionsOnHome } from '../src/core/analysis/signals';
import type { MeasuredDay } from '../src/core/domain/types';
import { checkSleepNotice } from '../src/services/sleepNotice';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import { repoWithPlan } from './helpers/plan';

const mockSent: string[] = [];
jest.mock('../src/platform/reminder', () => ({ notifyNow: async (id: string) => { mockSent.push(id); return true; } }));

describe('Kontroll över signaler', () => {
  it('knows quiet hours, also over midnight', () => {
    const q = { start: '22:00', end: '07:00' };
    expect(inQuietHours(q, new Date(2026, 10, 4, 23, 30))).toBe(true);
    expect(inQuietHours(q, new Date(2026, 10, 4, 6, 59))).toBe(true);
    expect(inQuietHours(q, new Date(2026, 10, 4, 7, 0))).toBe(false);
    expect(inQuietHours({ start: '13:00', end: '15:00' }, new Date(2026, 10, 4, 14))).toBe(true);
    expect(inQuietHours(null, new Date(2026, 10, 4, 23, 30))).toBe(false);
  });

  it('shows proposals directly, on Mondays, or only before a visit', () => {
    expect(suggestionsOnHome(undefined, '2026-11-04')).toBe(true);
    expect(suggestionsOnHome('weekly', '2026-11-02')).toBe(true); // a Monday
    expect(suggestionsOnHome('weekly', '2026-11-04')).toBe(false);
    expect(suggestionsOnHome('visit', '2026-11-02')).toBe(false);
  });

  it('keeps the sleep notice on the home screen but sends no notification in quiet hours', async () => {
    const repo = await repoWithPlan();
    const T = '2026-11-04';
    const days: MeasuredDay[] = Array.from({ length: 13 }, (_, i) => ({
      date: addDays(T, -i), sleepHours: i < 3 ? 5.5 : 7.5, sleepStart: '23:00', sleepEnd: '06:30', deepMinutes: null, remMinutes: null,
      stressAvg: null, stressHighMinutes: null, bodyBatteryWake: null, fetchedAt: '',
    }));
    await repo.saveGarminDays(days, T);
    await repo.updateSettings({ quietHours: { start: '22:00', end: '07:00' } });
    const night = new Date(2026, 10, 5, 2, 0); // 02:00, still 4 November's day
    const n = await checkSleepNotice(repo, night, { quiet: (now) => inQuietHours(repo.settings().quietHours, now) });
    expect([n?.reason, n?.notified, mockSent.length]).toEqual(['short', false, 0]);
  });

  it('saves the low mode and the pace as the person\'s own settings', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.updateSettings({ lowMode: true, suggestionPace: 'visit' });
    expect(repo.settings()).toMatchObject({ lowMode: true, suggestionPace: 'visit' });
  });
});
