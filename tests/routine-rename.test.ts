// Renaming a routine: the line changes in the plan, and the routine keeps its id, settings and history.

import { renameLine } from '../src/core/plan/blocks';
import { planBlocks, saveBlock } from '../src/services/planBlocks';
import { renameRoutine, setRoutineDone } from '../src/services/routines';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

describe('Byta namn på en rutin', () => {
  it('replaces one line, keeping its list mark and the other lines', () => {
    const text = '- Promenad 3 gånger i veckan\n- Läser en stund\n  innan jag somnar\n2. Drick ingen alkohol';
    expect(renameLine(text, 'Promenad 3 gånger i veckan', 'kvällspromenad 3 gånger i veckan'))
      .toBe('- Kvällspromenad 3 gånger i veckan\n- Läser en stund\n  innan jag somnar\n2. Drick ingen alkohol');
    // A line over two rows is replaced whole.
    expect(renameLine(text, 'Läser en stund innan jag somnar', 'Läser en bok'))
      .toBe('- Promenad 3 gånger i veckan\n- Läser en bok\n2. Drick ingen alkohol');
    expect(renameLine(text, 'Finns inte', 'X')).toBeNull();
    expect(renameLine(text, 'Läser en stund innan jag somnar', '  ')).toBeNull();
  });

  it('keeps the routine\'s id, how often, the reminder and the history', async () => {
    const repo = await Repository.create(memoryBackend());
    await saveBlock(repo, { id: 'b_routine', type: 'routine', heading: 'Livsstil och rutiner', text: '- Promenad 3 gånger i veckan\n- Drick ingen alkohol', updatedAt: '' });
    const walk = repo.contextOf('routine').find((e) => e.text.startsWith('Promenad'))!;
    await repo.updateContextEntry(walk.id, { routine: { track: true, reminder: '18:00', frequency: { kind: 'weekly', times: 3 } } });
    await setRoutineDone(repo, '2026-11-12', walk, true);

    const renamed = await renameRoutine(repo, repo.contextOf('routine').find((e) => e.id === walk.id)!, 'kvällspromenad 3 gånger i veckan');
    expect(renamed).toMatchObject({ id: walk.id, text: 'Kvällspromenad 3 gånger i veckan', routine: { reminder: '18:00', frequency: { kind: 'weekly', times: 3 } } });
    expect(repo.contextOf('routine').map((e) => e.text)).toEqual(['Kvällspromenad 3 gånger i veckan', 'Drick ingen alkohol']);
    expect(planBlocks(repo).find((b) => b.id === 'b_routine')!.text).toBe('- Kvällspromenad 3 gånger i veckan\n- Drick ingen alkohol');
    expect(repo.contextOf('routine_done').map((e) => e.routineId)).toEqual([walk.id]);
    // The same words again change nothing.
    expect(await renameRoutine(repo, renamed!, 'Kvällspromenad 3 gånger i veckan')).toBeNull();
  });
});
