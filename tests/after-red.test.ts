// C2 Dagen efter rött: the next check-in asks about the plan's steps at red, the answers are
// saved and shown in Inför återbesök, and they never change a level.

import { redFollowup, redStepAnswers } from '../src/core/analysis/afterRed';
import { setRedStep } from '../src/services/afterRed';
import { saveCheckin } from '../src/services/checkin';
import { visitSummary } from '../src/services/visit';
import { at, note, repoWithPlan } from './helpers/plan';

describe('Dagen efter rött', () => {
  it('asks about the steps at red the day after, saves the answers and shows them before a visit', async () => {
    const repo = await repoWithPlan();
    const red = await saveCheckin(repo, note('Svarar inte på sms. Slutar äta.'), at('2026-11-03'));
    expect(red.assessment.level).toBe('red');
    const q = redFollowup(repo.assessments(), repo.contextEntries(), repo.plan(), '2026-11-04');
    expect(q).toEqual({ date: '2026-11-03', yesterday: true, steps: ['Ringer mottagningen', 'Ber min bror komma hem'] });

    await setRedStep(repo, '2026-11-03', 'Ringer mottagningen', true);
    await setRedStep(repo, '2026-11-03', 'Ber min bror komma hem', false);
    await setRedStep(repo, '2026-11-03', 'Ber min bror komma hem', true);
    expect(Object.fromEntries(redStepAnswers(repo.contextEntries(), '2026-11-03'))).toEqual({ 'Ringer mottagningen': true, 'Ber min bror komma hem': true });

    const today = await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-04'));
    expect(today.assessment.level).not.toBe('red');
    expect(visitSummary(repo, 14, at('2026-11-04')).redSteps).toEqual([
      { date: '2026-11-03', steps: [{ text: 'Ringer mottagningen', done: true }, { text: 'Ber min bror komma hem', done: true }] },
    ]);
  });

  it('asks nothing after a day that was not red, and says the date when the red day was earlier', async () => {
    const repo = await repoWithPlan();
    await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-03'));
    expect(redFollowup(repo.assessments(), repo.contextEntries(), repo.plan(), '2026-11-04')).toBeNull();
    await saveCheckin(repo, note('Svarar inte på sms. Slutar äta.'), at('2026-11-05'));
    expect(redFollowup(repo.assessments(), repo.contextEntries(), repo.plan(), '2026-11-08')).toMatchObject({ date: '2026-11-05', yesterday: false });
    expect(redFollowup(repo.assessments(), repo.contextEntries(), repo.plan(), '2026-11-20')).toBeNull();
  });

  it('"Vill inte svara" takes the question away for that red day only', async () => {
    const repo = await repoWithPlan();
    await saveCheckin(repo, note('Svarar inte på sms. Slutar äta.'), at('2026-11-03'));
    expect(redFollowup(repo.assessments(), repo.contextEntries(), repo.plan(), '2026-11-04', '2026-11-03')).toBeNull();
    expect(redFollowup(repo.assessments(), repo.contextEntries(), repo.plan(), '2026-11-04', '2026-10-20')).not.toBeNull();
  });
});
