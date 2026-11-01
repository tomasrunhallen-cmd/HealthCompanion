// The crisis plan as text blocks: one block per heading, rows made from the lines in code,
// ids kept when the text is unchanged, and an imported plan grouped into blocks.

import fs from 'node:fs';
import path from 'node:path';
import {
  blockFields, blockLines, blocksFromRows, diffPlans, emptyPlan, planAsText, rowsFromBlock, TEMPLATE, typeFromFields, type PlanBlock,
} from '../src/core/plan/blocks';
import { draftFromText } from '../src/core/plan/importPlan';
import { routinesToday } from '../src/core/plan/routines';
import { planBlocks, savePlanBlocks } from '../src/services/planBlocks';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

/** Invented, in the style of a real plan's routines at early signs. */
const UP_ROUTINES = `Upprätthåll rutiner - framförallt sömn. Sömn 22:30 - 07:00.
Varannan dag promenad och varannan dag yoga/andningsövningar
Ät frukost runt kl 8, lunch runt kl 12 och middag runt kl 16:30.
Håll hårt i arbetstider och se över arbetsbelastningen. Ta hjälp av chefen att gå igenom
arbetsuppgifter och prioriteringar.
Undvik att posta inlägg på sociala medier.
Minimera inköp - checka av med Kim inför större köp
Undvika sociala situationer med fler än 4 personer.
Drick ingen alkohol.`;

function plan(): PlanBlock[] {
  const text: Partial<Record<PlanBlock['type'], string>> = {
    routine: '- Sömn 22:30–07:00\n- Tar min medicin klockan 21\n- Promenad varje dag',
    early_up: '- Pratar fortare och avbryter\n- Behöver mindre sömn',
    early_down: 'Svarar inte på sms\nOrkar inte laga mat',
    routine_up: UP_ROUTINES,
    action_early: '1. Ringer mottagningen\n2. Går och lägger mig före 23',
    serious_down: 'Slutar äta\nKänner att familjen klarar sig bättre utan mig',
    ladder: '1. Om jag inte lyssnar på mina närstående ringer de mottagningen.\n2. Om jag inte lyssnar på mottagningen bokar de ett hembesök.',
    wishes: 'Jag vill att min bror kontaktas först.',
    normal: 'Sover sju timmar, jobbar dagtid.',
  };
  return emptyPlan(new Date('2026-11-01T10:00:00Z')).map((b) => ({ ...b, text: text[b.type] ?? '' }));
}

describe('the template', () => {
  it('has the usual headings, in the order a plan is read', () => {
    const shown = TEMPLATE.filter((t) => t.inTemplate).map((t) => t.heading);
    expect(shown[0]).toBe('Värdeankare – det som är viktigt för mig');
    expect(shown).toContain('Livsstil och rutiner – varje dag');
    expect(shown).toContain('Livsstil och rutiner vid uppvarvning');
    expect(shown.indexOf('Tidiga varningstecken – uppvarvning')).toBeLessThan(shown.indexOf('Tecken på allvarlig försämring – uppvarvning'));
    expect(shown.at(-1)).toBe('Till vården');
  });
});

describe('rows from a block', () => {
  it('makes one row per line, joins wrapped lines and keeps the person\'s words', () => {
    const lines = blockLines(UP_ROUTINES).map((l) => l.text);
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe('Upprätthåll rutiner - framförallt sömn. Sömn 22:30 - 07:00.');
    expect(lines[3]).toBe('Håll hårt i arbetstider och se över arbetsbelastningen. Ta hjälp av chefen att gå igenom arbetsuppgifter och prioriteringar.');
  });

  it('gives every row the block\'s fields; a ladder keeps its order and says who acts', () => {
    const blocks = plan();
    const up = rowsFromBlock(blocks.find((b) => b.type === 'routine_up')!);
    expect(up.every((r) => r.fields.kind === 'routine' && r.fields.polarity === 'up')).toBe(true);
    const ladder = rowsFromBlock(blocks.find((b) => b.type === 'ladder')!);
    expect(ladder.map((r) => [r.fields.order, r.fields.who])).toEqual([[1, 'relative'], [2, 'care']]);
    const serious = rowsFromBlock(blocks.find((b) => b.type === 'serious_down')!);
    expect(serious.map((r) => r.akut)).toEqual([false, true]);
    expect(blockFields({ type: 'early_up', heading: 'x', observer: 'others' })).toMatchObject({ kind: 'sign', severity: 'early', polarity: 'up', observer: 'others' });
  });
});

describe('saving the plan', () => {
  it('makes the rows the app uses, keeps ids for unchanged lines, and removes lines that are gone', async () => {
    const repo = await Repository.create(memoryBackend());
    const res = await savePlanBlocks(repo, plan());
    expect(res.sleepWindow).toEqual({ start: '22:30', end: '07:00', text: 'Sömn 22:30–07:00' });
    expect(repo.planOf('early').map((p) => [p.text, p.plan?.polarity])).toEqual([
      ['Pratar fortare och avbryter', 'up'], ['Behöver mindre sömn', 'up'], ['Svarar inte på sms', 'down'], ['Orkar inte laga mat', 'down'],
    ]);
    expect(repo.planOf('action_yellow').map((p) => p.text)).toEqual(['Ringer mottagningen', 'Går och lägger mig före 23']);
    expect(repo.contextOf('akut').map((e) => e.text)).toEqual(['Känner att familjen klarar sig bättre utan mig']);
    expect(repo.planSettings().normalState).toBe('Sover sju timmar, jobbar dagtid.');
    expect(repo.contextOf('wish')).toHaveLength(1);

    const med = repo.contextOf('routine').find((e) => e.text === 'Tar min medicin klockan 21')!;
    await repo.updateContextEntry(med.id, { routine: { track: true, reminder: '21:00' } });
    const edited = planBlocks(repo).map((b) => (b.type === 'routine' ? { ...b, text: '- Sömn 22:30–07:00\n- Tar min medicin klockan 21\n- Yoga på söndagar' } : b));
    await savePlanBlocks(repo, edited);
    const after = repo.contextOf('routine').filter((e) => e.plan?.polarity === 'both');
    expect(after.map((e) => e.text)).toEqual(['Sömn 22:30–07:00', 'Tar min medicin klockan 21', 'Yoga på söndagar']);
    expect(after[1]).toMatchObject({ id: med.id, routine: { reminder: '21:00' } });
    expect(planBlocks(repo).find((b) => b.type === 'routine')!.text).toContain('Yoga på söndagar');
  });

  it('shows the daily routines, and the ones for a direction only while the person follows the plan for it', async () => {
    const repo = await Repository.create(memoryBackend());
    await savePlanBlocks(repo, plan());
    const none = routinesToday(repo.contextEntries(), null);
    expect([none.daily.length, none.extra.length]).toEqual([3, 0]);
    const up = routinesToday(repo.contextEntries(), { direction: 'up' });
    expect(up.extra.map((e) => e.text)).toContain('Drick ingen alkohol.');
    expect(routinesToday(repo.contextEntries(), { direction: 'down' }).extra).toHaveLength(0);
  });

  it('shows a plan saved as rows before blocks existed as blocks', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addContextEntry({ kind: 'early', text: 'Svarar inte på sms', origin: 'crisis_plan', plan: { kind: 'sign', polarity: 'down', severity: 'early', observer: 'self' } });
    await repo.addContextEntry({ kind: 'action_red', text: 'Ring mottagningen', origin: 'crisis_plan' });
    const blocks = planBlocks(repo);
    expect(blocks.find((b) => b.type === 'early_down')!.text).toBe('Svarar inte på sms');
    expect(blocks.find((b) => b.type === 'action_serious')!.text).toBe('Ring mottagningen');
  });
});

describe('an imported plan', () => {
  it('becomes blocks by its headings, with the type from the rules table', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'krisplan-exempel.md'), 'utf8');
    const draft = draftFromText(md);
    const blocks = blocksFromRows(draft.rows);
    const by = (h: string) => blocks.find((b) => b.heading === h)!;
    expect(blocks.length).toBeLessThan(30);
    expect(by('Tidiga varningstecken – Tecken för omgivningen, mani')).toMatchObject({ type: 'early_up', observer: 'others' });
    expect(by('Livsstil och rutiner – Vid tecken på mani').type).toBe('routine_up');
    expect(by('Strategier för att undvika tvångsåtgärder').type).toBe('ladder');
    expect(by('Patientens önskemål').type).toBe('wishes');
    expect(by('Det här hjälper mig att hitta tillbaka').type).toBeNull();
    expect(by('Värdeankare').text.split('\n')).toHaveLength(4);
    expect(typeFromFields({ kind: 'action', polarity: 'both', when: 'early', who: 'care', order: null })).toBe('relatives_early');
  });
});

describe('an updated plan', () => {
  it('shows what is new, changed and removed, line by line', () => {
    const old = plan();
    const next = old.map((b) =>
      b.type === 'early_up' ? { ...b, text: '- Pratar fortare och avbryter\n- Handlar saker jag inte behöver' } : b.type === 'wishes' ? { ...b, text: '' } : b,
    );
    next.push({ id: 'n1', type: 'trigger', heading: 'Risksituationer', text: 'Långa resor', updatedAt: '' });
    const d = diffPlans(old, next);
    expect(d.find((c) => c.type === 'early_up')).toMatchObject({ status: 'changed', added: ['Handlar saker jag inte behöver'], removed: ['Behöver mindre sömn'], kept: 1 });
    expect(d.find((c) => c.type === 'trigger')).toMatchObject({ status: 'new', added: ['Långa resor'] });
    expect(d.find((c) => c.type === 'wishes')).toMatchObject({ status: 'changed', removed: ['Jag vill att min bror kontaktas först.'] });
    expect(d.find((c) => c.type === 'routine')!.status).toBe('same');
    expect(planAsText(next)).toContain('Tidiga varningstecken – uppvarvning\n- Pratar fortare och avbryter');
  });
});

describe('the template as text', () => {
  it('reads back into the same blocks: every patient can write the plan under the same headings', () => {
    const filled = emptyPlan().filter((b) => b.type !== 'normal').map((b, i) => ({ ...b, text: `Rad ${i + 1} under blocket` }));
    const text = planAsText(filled);
    const back = blocksFromRows(draftFromText(text).rows);
    expect(back.map((b) => [b.heading, b.type])).toEqual(filled.map((b) => [b.heading, b.type]));
  });

  it('reads a heading in the person\'s own words, "Livsstil och rutiner vid uppvarvning/mani"', () => {
    const back = blocksFromRows(draftFromText('Livsstil och rutiner vid uppvarvning/mani\nDrick ingen alkohol.\nUndvik stora köp.').rows);
    expect(back.map((b) => [b.type, b.text])).toEqual([['routine_up', 'Drick ingen alkohol.\nUndvik stora köp.']]);
  });
});
