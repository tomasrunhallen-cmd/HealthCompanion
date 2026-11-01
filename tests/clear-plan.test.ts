// Rensa: one part of the plan emptied, or the whole plan cleared, with a copy to take it back.

import { clearBlock, clearPlan, planBackup, planBlocks, planOriginal, restorePlan, ORIGINAL_KEY } from '../src/services/planBlocks';
import { saveCheckin } from '../src/services/checkin';
import { setRoutineDone } from '../src/services/routines';
import { at, note, repoWithPlan } from './helpers/plan';

describe('Rensa krisplanen', () => {
  it('empties one part: its rows go, the heading and the rest of the plan stay', async () => {
    const repo = await repoWithPlan();
    const up = planBlocks(repo).find((b) => b.type === 'early_up')!;
    await clearBlock(repo, up.id);
    expect(planBlocks(repo).find((b) => b.type === 'early_up')).toMatchObject({ heading: up.heading, text: '' });
    expect(repo.planOf('early').map((p) => p.text)).toEqual(['Svarar inte på sms']);
    expect(repo.contextOf('routine')).toHaveLength(2);
  });

  it('clears the whole plan but keeps the days, the ticks and the person\'s own emergency phrases, and can take it back', async () => {
    const repo = await repoWithPlan();
    await repo.updatePlanSettings({ normalState: 'Sover sju timmar.', sleepWindow: { start: '22:30', end: '07:00' }, polarityWords: { up: 'mani' } });
    await repo.kvSet(ORIGINAL_KEY, { text: 'Planen som den lästes in', sourceName: 'plan.pdf', at: '' });
    await repo.addPlanItems([{ id: 'own', kind: 'akut', text: 'Jag orkar inte mer' }]);
    await repo.addContextEntry({ kind: 'early', text: 'Standardtecken', origin: 'standard', approvedAt: null });
    await saveCheckin(repo, note('Pratar fortare.'), at('2026-11-03'));
    await setRoutineDone(repo, '2026-11-03', repo.contextOf('routine')[0], true);

    const res = await clearPlan(repo, new Date('2026-11-04T10:00:00Z'));
    expect(res.rows).toBeGreaterThan(10);
    expect(planBlocks(repo).every((b) => !b.text.trim())).toBe(true);
    expect(repo.plan().map((p) => p.text)).toEqual(['Jag orkar inte mer']);
    for (const kind of ['routine', 'contact', 'trigger'] as const) expect(repo.contextOf(kind)).toEqual([]);
    expect(repo.planSettings()).toMatchObject({ normalState: '' });
    expect(repo.planSettings().sleepWindow).toBeUndefined();
    expect(planOriginal(repo)).toBeNull();
    expect(repo.entries()).toHaveLength(1);
    expect(repo.contextOf('routine_done')).toHaveLength(1);

    expect(planBackup(repo)?.at).toBe('2026-11-04T10:00:00.000Z');
    expect(await restorePlan(repo)).toBe(true);
    expect(repo.planOf('early').map((p) => p.text)).toEqual(['Pratar fortare', 'Handlar saker jag inte behöver', 'Svarar inte på sms']);
    expect(repo.contextOf('routine')).toHaveLength(2);
    expect(repo.planSettings()).toMatchObject({ normalState: 'Sover sju timmar.', sleepWindow: { start: '22:30', end: '07:00' }, polarityWords: { up: 'mani' } });
    expect(planOriginal(repo)?.sourceName).toBe('plan.pdf');
    expect(planBackup(repo)).toBeNull();
  });
});
