// C9 Uppdaterad plan: a new version of the plan from the care is read in and compared with the
// saved plan, line by line, before anything is saved. Unchanged lines keep their history.

import { blocksFromRows, diffPlans, planAsText, type PlanBlock } from '../src/core/plan/blocks';
import { draftFromText } from '../src/core/plan/importPlan';
import { planBlocks, savePlanBlocks } from '../src/services/planBlocks';
import { setRoutineDone } from '../src/services/routines';
import { repoWithPlan } from './helpers/plan';

describe('Uppdaterad plan', () => {
  it('shows what changed in the new plan from the care, and keeps the history of unchanged lines', async () => {
    const repo = await repoWithPlan();
    const walk = repo.contextOf('routine').find((r) => r.text === 'Promenad varje dag')!;
    await setRoutineDone(repo, '2026-11-03', walk, true);

    const oldText = planAsText(planBlocks(repo));
    const newText = oldText
      .replace('- Svarar inte på sms', '- Svarar inte på sms\n- Ställer in träffar')
      .replace('- Handlar saker jag inte behöver\n', '');
    const read = blocksFromRows(draftFromText(newText).rows).filter((b): b is PlanBlock => b.type != null);
    const changes = diffPlans(planBlocks(repo), read).filter((c) => c.status !== 'same');
    expect(changes.map((c) => [c.type, c.added, c.removed])).toEqual([
      ['early_up', [], ['Handlar saker jag inte behöver']],
      ['early_down', ['Ställer in träffar'], []],
    ]);

    await savePlanBlocks(repo, read);
    const after = repo.contextOf('routine').find((r) => r.text === 'Promenad varje dag')!;
    expect(after.id).toBe(walk.id);
    expect(repo.contextOf('routine_done').filter((e) => e.routineId === walk.id)).toHaveLength(1);
    expect(repo.planOf('early').map((p) => p.text)).toEqual(['Pratar fortare', 'Svarar inte på sms', 'Ställer in träffar']);
  });
});
