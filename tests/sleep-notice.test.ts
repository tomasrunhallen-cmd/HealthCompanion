// C5 Sömnnotis: the third night in a row under the person's own average, or outside the plan's
// sleep window, gives one notice with the plan's sleep routine. No points.

import { addDays } from '../src/core/analysis/dates';
import { sleepNotice, sleepRoutineText } from '../src/core/analysis/sleepNotice';
import type { MeasuredDay } from '../src/core/domain/types';
import { saveCheckin } from '../src/services/checkin';
import { checkSleepNotice, todaysSleepNotice } from '../src/services/sleepNotice';
import { at, note, repoWithPlan } from './helpers/plan';

// The phone's notifications are not available in tests; the notice is still saved.
jest.mock('../src/platform/reminder', () => ({ notifyNow: async () => false }));

const T = '2026-11-04';
const night = (date: string, sleepHours: number, sleepStart = '22:40', sleepEnd = '07:00'): MeasuredDay => ({
  date, sleepHours, sleepStart, sleepEnd, deepMinutes: null, remMinutes: null, stressAvg: null, stressHighMinutes: null, bodyBatteryWake: null, fetchedAt: '',
});
function nights(last3: [number, string?][]): Record<string, MeasuredDay> {
  const out: Record<string, MeasuredDay> = {};
  for (let i = 3; i < 13; i++) out[addDays(T, -i)] = night(addDays(T, -i), 7.5);
  last3.forEach(([h, start], i) => { const d = addDays(T, -(2 - i)); out[d] = night(d, h, start); });
  return out;
}
const opts = { window: { start: '22:30', end: '07:00' }, sleepRoutine: 'Sömn 22:30–07:00' };

describe('Sömnnotis', () => {
  it('comes on the third short night in a row, with the plan\'s own sleep routine', () => {
    const n = sleepNotice(nights([[6.5], [6], [6.8]]), T, opts);
    expect(n).toMatchObject({ reason: 'short', average: 7.5, nights: ['2026-11-02', '2026-11-03', '2026-11-04'] });
    expect(n!.body).toBe('Tredje natten i rad med kortare sömn än ditt snitt på 7,5 timmar. Din plan säger: ”Sömn 22:30–07:00”.');
    expect(sleepNotice(nights([[6.5], [7.6], [6.8]]), T, opts)).toBeNull();
  });

  it('comes on the third night in a row outside the sleep window, also across midnight', () => {
    const n = sleepNotice(nights([[7.6, '00:45'], [7.7, '01:10'], [7.8, '00:05']]), T, opts);
    expect(n).toMatchObject({ reason: 'window' });
    expect(n!.body).toContain('utanför ditt sömnfönster 22:30–07:00');
    expect(sleepNotice(nights([[7.6, '00:45'], [7.7, '23:10'], [7.8, '00:05']]), T, opts)).toBeNull();
    expect(sleepNotice(nights([[7.6, '00:45'], [7.7, '01:10'], [7.8, '00:05']]), T, { ...opts, window: null })).toBeNull();
  });

  it('needs three nights and an own average', () => {
    const few = { [T]: night(T, 4), [addDays(T, -1)]: night(addDays(T, -1), 4), [addDays(T, -2)]: night(addDays(T, -2), 4) };
    expect(sleepNotice(few, T, { ...opts, window: null })).toBeNull();
    expect(sleepRoutineText([{ text: 'Promenad' }, { text: 'Sömn 22:30–07:00 alla dagar' }])).toBe('Sömn 22:30–07:00 alla dagar');
  });

  it('is saved once a day, shown on the home screen, and never changes the level', async () => {
    const repo = await repoWithPlan();
    await repo.updatePlanSettings({ sleepWindow: { start: '22:30', end: '07:00' } });
    await repo.saveGarminDays(Object.values(nights([[6.5], [6], [6.8]])), T);
    const now = at(T, '12:00');
    const first = await checkSleepNotice(repo, now);
    expect(first).toMatchObject({ reason: 'short', date: T, notified: false });
    expect(first!.body).toContain('”Sömn 22:30–07:00”');
    expect(await checkSleepNotice(repo, now)).toEqual(first);
    expect(todaysSleepNotice(repo, now)).toEqual(first);
    const { assessment } = await saveCheckin(repo, note('Vanlig dag.'), at(T));
    expect(assessment.signals.some((s) => /snitt/.test(s.label))).toBe(false);
  });
});
