// C7 Gröna dagar: a routine from the plan and how long it has been kept. Never "allt ser bra ut".

import { greenDayLine, routineStreak } from '../src/core/plan/routines';
import { saveCheckin } from '../src/services/checkin';
import { setRoutineDone } from '../src/services/routines';
import { at, note, repoWithPlan } from './helpers/plan';

describe('Gröna dagar', () => {
  it('counts the days in a row a routine was ticked off, and today only once ticked', async () => {
    const repo = await repoWithPlan();
    const walk = repo.contextOf('routine').find((r) => r.text === 'Promenad varje dag')!;
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) await setRoutineDone(repo, d, walk, true);
    expect(routineStreak(repo.contextEntries(), walk, '2026-11-04')).toBe(3);
    await setRoutineDone(repo, '2026-11-04', walk, true);
    expect(routineStreak(repo.contextEntries(), walk, '2026-11-04')).toBe(4);
    expect(routineStreak(repo.contextEntries(), walk, '2026-11-06')).toBe(0);
    expect(greenDayLine(repo.contextEntries(), '2026-11-04')).toBe('”Promenad varje dag” hållen 4 dagar i rad.');
  });

  it('keeps the sleep routine on nights the watch shows inside the sleep window', async () => {
    const repo = await repoWithPlan();
    const night = (start: string, end: string) => ({ sleepStart: start, sleepEnd: end });
    const measured = { '2026-11-02': night('22:50', '06:40'), '2026-11-03': night('23:15', '07:20'), '2026-11-04': night('22:35', '07:05'), '2026-11-01': night('01:30', '08:00') };
    const line = greenDayLine(repo.contextEntries(), '2026-11-04', { measured, window: { start: '22:30', end: '07:00' } });
    expect(line).toBe('Sömnrutinen 22:30–07:00 hållen 3 nätter i rad.');
  });

  it('says nothing under two days, and never that all is well', async () => {
    const repo = await repoWithPlan();
    expect(greenDayLine(repo.contextEntries(), '2026-11-04')).toBeNull();
    const { assessment } = await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-04'));
    expect(assessment.level).toBe('green');
    expect(assessment.sentence).toBe('Inget av dina tecken syntes i dag.');
  });
});
