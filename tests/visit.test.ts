// C1 Inför återbesök: level per day, sleep and stress, signs by direction, routines, the
// person's own list, and a PDF without any notes.

import { routineLine } from '../src/core/analysis/visit';
import { saveCheckin } from '../src/services/checkin';
import { setRoutineDone } from '../src/services/routines';
import { addVisitTopic, removeVisitTopic, visitHtml, visitSummary, visitTopics } from '../src/services/visit';
import { at, note, repoWithPlan } from './helpers/plan';


describe('Inför återbesök', () => {
  it('sums up the period by level, signs by direction and routines, with the person\'s own list', async () => {
    const repo = await repoWithPlan();
    await saveCheckin(repo, note('Pratar fortare i dag, märker alla.'), at('2026-11-02'));
    await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-03'));
    await saveCheckin(repo, note('Svarar inte på sms. Slutar äta.'), at('2026-11-04'));
    const walk = repo.contextOf('routine').find((r) => r.text === 'Promenad varje dag')!;
    await setRoutineDone(repo, '2026-11-03', walk, true);
    await setRoutineDone(repo, '2026-11-04', repo.contextOf('routine')[0], true);
    await addVisitTopic(repo, 'Sömnen när det blir mörkt');
    await addVisitTopic(repo, 'Medicinen');
    await removeVisitTopic(repo, visitTopics(repo)[1].id);

    const s = visitSummary(repo, 14, at('2026-11-04'));
    expect([s.from, s.to, s.days.length]).toEqual(['2026-10-22', '2026-11-04', 14]);
    expect(s.counts).toEqual({ green: 1, yellow: 1, red: 1, none: 11, limitedGreen: 1 });
    expect(s.signs.up).toEqual([{ text: 'Pratar fortare', days: 1 }]);
    expect(s.signs.down.map((x) => x.text).sort()).toEqual(['Slutar äta', 'Svarar inte på sms']);
    expect(s.routines).toEqual([{ text: 'Sömn 22:30–07:00', done: 1, notDone: 0, unanswered: 13 }, { text: 'Promenad varje dag', done: 1, notDone: 0, unanswered: 13 }]);
    expect(s.topics.map((t) => t.text)).toEqual(['Sömnen när det blir mörkt']);
    expect(visitSummary(repo, 30, at('2026-11-04')).days).toHaveLength(30);

    const html = visitHtml(s, repo.planSettings());
    expect(html).toContain('Sömnen när det blir mörkt');
    expect(html).toContain('◆ Rött');
    expect(html).toContain('Pratar fortare (1 dag)');
    expect(html).not.toContain('märker alla');
    expect(html).not.toContain('Vanlig dag');
  });

  it('counts each routine on its own answers: one without any is "Ingen uppgift", in the view and the PDF', async () => {
    const repo = await repoWithPlan();
    await saveCheckin(repo, note('Vanlig dag.'), at('2026-11-03'));
    const walk = repo.contextOf('routine').find((r) => r.text === 'Promenad varje dag')!;
    const sleep = repo.contextOf('routine').find((r) => r.text === 'Sömn 22:30–07:00')!;
    await setRoutineDone(repo, '2026-11-03', walk, true);
    await setRoutineDone(repo, '2026-11-04', walk, false);
    const s = visitSummary(repo, 14, at('2026-11-04'));
    expect(s.routines.map(routineLine)).toEqual(['Sömn 22:30–07:00: Ingen uppgift', 'Promenad varje dag: gjord 1 dag, inte gjord 1, 12 utan svar']);
    expect(sleep).toBeDefined();
    const html = visitHtml(s, repo.planSettings());
    expect(html).toContain('Sömn 22:30–07:00: Ingen uppgift');
    expect(html).not.toContain('0 av');
  });
});
