// A plan whose steps at red are a numbered ladder under "Överenskomna strategier för att undvika
// tvångsåtgärder", with the clinic's phone number on the lines before the heading. Invented text with
// the same structure as a real plan that was read wrongly: the heading was joined with the phone
// line, and Hjälp nu said the plan had no steps at red although they were there.

import { draftFromText } from '../src/core/plan/importPlan';
import { blockHeading, blocksFromRows, type PlanBlock } from '../src/core/plan/blocks';
import { crisisInfo } from '../src/core/context/akut';
import { actionsForLevel, firstStep } from '../src/core/analysis/assess';
import { redStepsAreLadder } from '../src/core/plan/guidance';
import { savePlanBlocks } from '../src/services/planBlocks';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const STEPS = [
  'Gå igenom krisplanen lugnt och stilla med mig. Om jag inte kontaktar vården:',
  'Ring och be min läkare eller sjuksköterska att ringa mig. Om jag inte lyssnar:',
  'Be mina vänner Kim och Alex höra av sig och föreslå att jag kontaktar vården. Om jag inte lyssnar:',
  'Kontakta vården akut.',
];
const LADDER = 'Överenskomna strategier för att undvika tvångsåtgärder';

/** Pasted text: no heading levels. */
const PLAIN = `Krisplan

Tidiga tecken
- Sover mindre än sex timmar
- Pratar fortare än vanligt

Mottagning Exempel, avdelning 12, telefonnummer:
08-000 00 00

${LADDER}
${STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`;

/** The same plan with heading levels, as from a PDF or Word file: the clinic line a heading above the ladder. */
const LEVELLED = `# Krisplan

## Tidiga tecken
- Sover mindre än sex timmar
- Pratar fortare än vanligt

## Mottagning Exempel, avdelning 12, telefonnummer
08-000 00 00

### ${LADDER}
${STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`;

async function saved(text: string) {
  const blocks = blocksFromRows(draftFromText(text).rows).filter((b): b is PlanBlock => b.type != null);
  const repo = await Repository.create(memoryBackend());
  await savePlanBlocks(repo, blocks);
  return { blocks, plan: repo.plan() };
}

describe('a plan whose steps at red are a ladder', () => {
  for (const [name, text] of [['pasted text', PLAIN], ['heading levels', LEVELLED]] as const) {
    it(`reads the ladder under its own heading (${name})`, async () => {
      const { blocks } = await saved(text);
      const ladder = blocks.find((b) => b.type === 'ladder')!;
      expect(ladder.heading).toBe(LADDER);
      expect(ladder.text.split('\n')).toEqual(STEPS);
      // The clinic and its number stay together, and never in the heading of the steps.
      expect(blocks.some((b) => b.heading.includes('telefonnummer') && b.type === 'ladder')).toBe(false);
      expect(blocks.map((b) => `${b.heading} ${b.text}`).join('\n')).toContain('08-000 00 00');
    });

    it(`shows the ladder as the plan at red in Hjälp nu, on a red day and in the emergency card (${name})`, async () => {
      const { plan } = await saved(text);
      expect(redStepsAreLadder(plan)).toBe(true);
      const info = crisisInfo(plan);
      expect(info.steps).toEqual(STEPS);
      expect(info.stepsFrom).toBe(LADDER);
      // Not shown a second time under its own heading.
      expect(info.ladder).toBeNull();
      expect(actionsForLevel('red', plan).map((p) => p.text)).toEqual(STEPS);
      expect(firstStep('red', plan)?.text).toBe(STEPS[0]);
    });
  }

  it('keeps the plan’s own steps at red first when it has them, and the ladder apart', async () => {
    const text = `${PLAIN}\nÅtgärder vid allvarliga tecken\n- Ring mottagningen samma dag\n`;
    const { plan } = await saved(text);
    const info = crisisInfo(plan);
    expect(info.steps).toEqual(['Ring mottagningen samma dag']);
    expect(info.stepsFrom).toBeNull();
    expect(info.ladder?.steps).toEqual(STEPS);
  });

  it('a heading chain keeps a known inner heading alone, and an unknown one with its context', () => {
    expect(blockHeading(`Mottagning Exempel, telefonnummer > ${LADDER}`)).toBe(LADDER);
    expect(blockHeading('Tidiga tecken > Mina egna ord')).toBe('Tidiga tecken – Mina egna ord');
    expect(blockHeading('Livsstil och rutiner > Vid tecken på mani')).toBe('Livsstil och rutiner – Vid tecken på mani');
    expect(blockHeading('')).toBe('Utan rubrik');
  });
});
