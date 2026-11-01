// C10 Första veckan: day 1 only the check-in, from day 3 a sleep source, on day 7 the first
// week with what green means.

import { firstWeek, GREEN_MEANS } from '../src/core/analysis/firstWeek';
import { saveCheckin } from '../src/services/checkin';
import { ensureFirstUse, firstWeekState, markFirstWeek } from '../src/services/firstWeek';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import { at, note } from './helpers/plan';

const none = { sleepSourceDismissed: false, hasSleepSource: false, weekPictureSeen: false };

describe('Första veckan', () => {
  it('shows only the check-in on day 1, a sleep source from day 3 and the week on day 7', () => {
    expect(firstWeek('2026-11-01', '2026-11-01', none)).toEqual({ day: 1, onlyCheckin: true, offerSleepSource: false, weekPicture: false });
    expect(firstWeek('2026-11-01', '2026-11-02', none)).toMatchObject({ onlyCheckin: false, offerSleepSource: false });
    expect(firstWeek('2026-11-01', '2026-11-03', none)).toMatchObject({ day: 3, offerSleepSource: true, weekPicture: false });
    expect(firstWeek('2026-11-01', '2026-11-07', none)).toMatchObject({ day: 7, offerSleepSource: true, weekPicture: true });
    expect(firstWeek('2026-11-01', '2026-11-07', { ...none, hasSleepSource: true, weekPictureSeen: true })).toMatchObject({ offerSleepSource: false, weekPicture: false });
    expect(firstWeek('2026-11-01', '2026-11-20', none)).toBeNull();
    expect(GREEN_MEANS).toContain('inte att allt är bra');
  });

  it('starts on the first day, or on the earliest entry for someone who used the app before', async () => {
    const fresh = await Repository.create(memoryBackend());
    await ensureFirstUse(fresh, at('2026-11-04'));
    expect(fresh.settings().firstUseAt).toBe('2026-11-04');
    expect(firstWeekState(fresh, at('2026-11-04'))?.onlyCheckin).toBe(true);

    const used = await Repository.create(memoryBackend());
    await saveCheckin(used, note('Vanlig dag.'), at('2026-09-01'));
    await ensureFirstUse(used, at('2026-11-04'));
    expect(used.settings().firstUseAt).toBe('2026-09-01');
    expect(firstWeekState(used, at('2026-11-04'))).toBeNull();
  });

  it('stops offering a sleep source once answered or once there is one', async () => {
    const repo = await Repository.create(memoryBackend());
    await ensureFirstUse(repo, at('2026-11-01'));
    expect(firstWeekState(repo, at('2026-11-03'))?.offerSleepSource).toBe(true);
    await saveCheckin(repo, { ...note('Vanlig dag.'), manualSleepHours: 7 }, at('2026-11-03'));
    expect(firstWeekState(repo, at('2026-11-03'))?.offerSleepSource).toBe(false);
    await markFirstWeek(repo, 'weekPicture');
    expect(firstWeekState(repo, at('2026-11-07'))?.weekPicture).toBe(false);
  });
});
