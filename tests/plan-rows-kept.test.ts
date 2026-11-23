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

  it('keeps lines the person wrote apart also after a long line or indented (granskning 23 november)', async () => {
    const text = 'Har svårt att sitta still och börjar många saker på en gång hela dagen\npratar fortare\n  sover mindre';
    expect(blockLines(text).map((l) => l.text)).toEqual(['Har svårt att sitta still och börjar många saker på en gång hela dagen', 'pratar fortare', 'sover mindre']);
    const repo = await Repository.create(memoryBackend());
    await savePlanBlocks(repo, [block('early_up', text)], NOW);
    const signs = repo.planOf('early');
    expect(signs).toHaveLength(3);
    expect(matchSigns('Jag pratar fortare i dag.', signs).map((m) => m.planItemId)).toEqual([signs[1].id]);
    expect(matchSigns('Sover mindre nu.', signs).map((m) => m.planItemId)).toEqual([signs[2].id]);
  });

  it('a document is joined when it is imported, and a saved broken line is only offered to be joined', () => {
    const { blocksFromRows } = require('../src/core/plan/blocks') as typeof import('../src/core/plan/blocks');
    const fields = { kind: 'routine' } as never;
    const [b] = blocksFromRows([
      { heading: 'Rutiner', text: 'Håll hårt i arbetstider. Ta hjälp av chefen att gå igenom', parentId: null, fields, special: null, source: 'rules' },
      { heading: 'Rutiner', text: 'arbetsuppgifter och prioriteringar.', parentId: null, fields, special: null, source: 'rules' },
    ], NOW);
    expect(blockLines(b.text).map((l) => l.text)).toEqual(['Håll hårt i arbetstider. Ta hjälp av chefen att gå igenom arbetsuppgifter och prioriteringar.']);
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
