import { exportAll, exportLayer, parseLayer } from '../src/core/context/markdown';
import { startWithStandard } from '../src/services/standard';
import type { ContextLayer } from '../src/core/domain/types';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

async function fullBank() {
  const repo = await Repository.create(memoryBackend());
  await startWithStandard(repo, new Date('2026-10-01T10:00:00Z'));
  await repo.addPlanItems([{ id: 'own', kind: 'serious', text: 'Slutar äta' }]);
  await repo.addPlanItems([{ id: 'ak', kind: 'akut', text: 'vill sova för evigt' }]);
  await repo.addContextEntry({ kind: 'trigger', text: 'Resor över tidszoner', origin: 'user' });
  await repo.addContextEntry({ kind: 'medication', text: 'Litium 600 mg\nSänkt till 450 mg i september', origin: 'user' });
  await repo.updatePlanSettings({ normalState: 'Sover sju timmar, jobbar dagtid' });
  await repo.addContextEntry({ kind: 'course', text: 'Först sömnen, två dagar senare nya idéer', origin: 'suggested' });
  await repo.addContextEntry({ kind: 'event', text: 'Resa till Umeå', origin: 'user', date: '2026-11-05' });
  await repo.addContextEntry({ kind: 'medication_taken', text: '', origin: 'user', date: '2026-11-01', taken: true });
  await repo.addContextEntry({ kind: 'correction', text: '', origin: 'correction', date: '2026-10-30', correction: { assessmentId: 'a1', verdict: 'disagree', planItemId: 'own' } });
  await repo.addContextEntry({ kind: 'correction', text: 'Var bara trött - inget mer', origin: 'correction', date: '2026-10-31', correction: { assessmentId: 'a2', verdict: 'agree', planItemId: null } });
  return repo;
}

describe('context export and import', () => {
  it('export followed by import gives an identical context bank', async () => {
    const repo = await fullBank();
    const before = repo.contextEntries();
    const files = exportAll(before, new Date('2026-11-01T12:00:00Z'), 'De senaste 14 dagarna: 9 gröna.');
    expect(Object.keys(files)).toEqual(['grund.md', 'profil.md', 'dagligt.md']);

    const target = await Repository.create(memoryBackend());
    for (const content of Object.values(files)) {
      const parsed = parseLayer(content);
      await target.replaceLayer(parsed.layer, parsed.entries);
    }
    expect(target.contextEntries()).toEqual(before);
  });

  it('is readable for a person', async () => {
    const repo = await fullBank();
    const grund = exportLayer('grund', repo.contextEntries(), new Date('2026-11-01T12:00:00Z'));
    expect(grund).toMatch(/^# Grund\n/);
    expect(grund).toContain('## Tidigt tecken\n\n- Sover mindre\n  _Standard, inte bekräftad_');
    expect(grund).toContain('## Medicin\n\n- Litium 600 mg\n  Sänkt till 450 mg i september\n  _Du själv_');
    const dagligt = exportLayer('dagligt', repo.contextEntries(), new Date(), 'De senaste 14 dagarna: 9 gröna.');
    expect(dagligt).toContain('_Du själv, söndag 1 november, tagen_');
    expect(dagligt).toContain('> De senaste 14 dagarna: 9 gröna.');
  });

  it('imports text edited by hand, and new bullets as the user\'s own', async () => {
    const repo = await fullBank();
    const edited = exportLayer('grund', repo.contextEntries())
      .replace('- Resor över tidszoner', '- Långa resor över tidszoner')
      .replace('## Medicin', '## Känt falsklarm\n\n- Kort sömn före tidiga flyg\n\n## Medicin');
    const parsed = parseLayer(edited, new Date('2026-11-02T10:00:00Z'));
    expect(parsed.layer).toBe('grund');
    expect(parsed.entries.find((e) => e.kind === 'trigger')?.text).toBe('Långa resor över tidszoner');
    expect(parsed.entries.find((e) => e.kind === 'false_alarm')).toMatchObject({ text: 'Kort sömn före tidiga flyg', origin: 'user', approvedAt: '2026-11-02T10:00:00.000Z' });
  });

  it('refuses files that are not context files, or entries in the wrong layer', async () => {
    expect(() => parseLayer('# Något annat\n- x')).toThrow('inte en exporterad kontextfil');
    const repo = await fullBank();
    const grund = exportLayer('grund', repo.contextEntries());
    expect(() => parseLayer(grund.replace('# Grund', '# Profil'))).toThrow('hör inte till Profil');
  });

  it('an empty layer exports and imports as empty', () => {
    for (const layer of ['grund', 'profil', 'dagligt'] as ContextLayer[]) {
      expect(parseLayer(exportLayer(layer, [])).entries).toEqual([]);
    }
  });
});
