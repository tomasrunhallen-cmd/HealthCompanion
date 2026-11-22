// Granskning 22 november: a row keeps the type the person gave it, and every line the person
// writes is its own row. Invented plan text only.
import { matchSigns } from '../src/core/analysis/wordmatch';
import { akutLevel, crisisInfo } from '../src/core/context/akut';
import { blockLines, type PlanBlock } from '../src/core/plan/blocks';
import { savePlanBlocks } from '../src/services/planBlocks';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const NOW = new Date('2026-11-22T10:00:00Z');
const block = (type: PlanBlock['type'], text: string): PlanBlock => ({ id: `b_${type}`, type, heading: type, text, updatedAt: NOW.toISOString() });

describe('a red step about suicidal thoughts', () => {
  it('stays a red step all the way to Hjälp nu, and is not made an emergency phrase', async () => {
    const repo = await Repository.create(memoryBackend());
    expect(akutLevel('Ring mottagningen vid självmordstankar')).not.toBeNull();
    await savePlanBlocks(repo, [block('action_serious', 'Ring mottagningen vid självmordstankar\nTa bort det farliga hemma')], NOW);
    expect(repo.planOf('action_red').map((p) => p.text)).toEqual(['Ring mottagningen vid självmordstankar', 'Ta bort det farliga hemma']);
    expect(repo.contextOf('akut')).toHaveLength(0);
    expect(crisisInfo(repo.plan()).steps).toContain('Ring mottagningen vid självmordstankar');
  });
});

describe('lines the person wrote', () => {
  it('two short lines are two signs, each matched on its own', async () => {
    expect(blockLines('sover mindre\npratar fortare').map((l) => l.text)).toEqual(['sover mindre', 'pratar fortare']);
    const repo = await Repository.create(memoryBackend());
    await savePlanBlocks(repo, [block('early_up', 'sover mindre\npratar fortare')], NOW);
    const signs = repo.planOf('early');
    expect(signs.map((s) => s.text)).toEqual(['sover mindre', 'pratar fortare']);
    expect(matchSigns('I dag pratar jag fortare än vanligt.', signs).map((m) => m.planItemId)).toEqual([signs[1].id]);
    expect(matchSigns('Jag sover mindre nu.', signs).map((m) => m.planItemId)).toEqual([signs[0].id]);
  });

  it('a line a document broke is still joined: indented, or after a long line without a full stop', () => {
    expect(blockLines('- Läser en stund\n  innan jag somnar').map((l) => l.text)).toEqual(['Läser en stund innan jag somnar']);
    expect(blockLines('Håll hårt i arbetstider och se över arbetsbelastningen. Ta hjälp av chefen att gå igenom\narbetsuppgifter och prioriteringar.').map((l) => l.text)).toHaveLength(1);
  });
});

describe('a plan saved by an older version', () => {
  it('gets the row back as a red step when the app opens', async () => {
    const { repairPlanRows } = require('../src/services/planBlocks') as typeof import('../src/services/planBlocks');
    const repo = await Repository.create(memoryBackend());
    await savePlanBlocks(repo, [block('action_serious', 'Ring mottagningen vid självmordstankar')], NOW);
    // As the older version left it: the row as an emergency phrase.
    const row = repo.planOf('action_red')[0];
    await repo.updateContextEntry(row.id, { kind: 'akut' }, false);
    expect(repo.planOf('action_red')).toHaveLength(0);
    expect(await repairPlanRows(repo, NOW)).toBe(true);
    expect(repo.planOf('action_red').map((p) => p.text)).toEqual(['Ring mottagningen vid självmordstankar']);
    expect(await repairPlanRows(repo, NOW)).toBe(false);
  });
});
