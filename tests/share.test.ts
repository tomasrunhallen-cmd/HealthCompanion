// C3 Visa för någon: only what the person chose, from the chosen period, never the notes.

import { saveCheckin } from '../src/services/checkin';
import { addVisitTopic, shareHtml, visitSummary } from '../src/services/visit';
import { at, note, repoWithPlan } from './helpers/plan';

describe('Visa för någon', () => {
  it('includes only the chosen parts, and never notes, own topics or routines', async () => {
    const repo = await repoWithPlan();
    await saveCheckin(repo, note('Pratar fortare, hemligt om grannen.'), at('2026-11-03'));
    await addVisitTopic(repo, 'Privat sak till läkaren');
    const s = visitSummary(repo, 7, at('2026-11-04'));
    expect(s.days).toHaveLength(7);
    const ps = repo.planSettings();

    const levels = shareHtml(s, { levels: true, sleepStress: false, signs: false }, ps);
    expect(levels).toContain('▲ Gult');
    expect(levels).not.toContain('Sömn (h)');
    expect(levels).not.toContain('Pratar fortare');

    const all = shareHtml(s, { levels: true, sleepStress: true, signs: true }, ps);
    expect(all).toContain('Pratar fortare (1 dag)');
    expect(all).toContain('Sömn (h)');
    for (const secret of ['hemligt om grannen', 'Privat sak till läkaren', 'Promenad varje dag']) expect(all).not.toContain(secret);
    expect(all).toContain('Utan anteckningar');
  });
});
