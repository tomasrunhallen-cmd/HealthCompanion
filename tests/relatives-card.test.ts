// C4 Anhörigkort: signs others can see, what relatives do, the ladder and contacts. Never the
// person's own experiences, wishes or notes for the care.

import { emptyPlan, type PlanBlock } from '../src/core/plan/blocks';
import { relativesCard, relativesCardHtml } from '../src/core/report/relativesCard';

const text: Partial<Record<PlanBlock['type'], string>> = {
  early_up: 'Tankarna går fort',
  relatives_early: 'Frågar hur jag sovit',
  others_serious: 'Ringer mottagningen om jag inte gör det',
  ladder: '1. Om jag inte lyssnar ringer de mottagningen.\n2. Om det inte räcker bokar mottagningen hembesök.',
  contacts: 'Mottagningen 08-123 456 78',
  wishes: 'Jag vill inte få injektioner',
  care: 'Litium har fungerat',
};

describe('Anhörigkort', () => {
  it('has the signs others can see, what relatives do, the ladder and the contacts, and nothing private', () => {
    const blocks = emptyPlan().map((b) => ({ ...b, text: text[b.type] ?? '' }));
    blocks.push({ id: 'o', type: 'early_up', heading: 'Tecken för omgivningen, mani', text: 'Pratar fortare\nSkickar många sms sent', observer: 'others', updatedAt: '' });
    const card = relativesCard(blocks);
    expect(card).toEqual({
      signsUp: ['Pratar fortare', 'Skickar många sms sent'], signsDown: [], signsOther: [],
      early: ['Frågar hur jag sovit'], serious: ['Ringer mottagningen om jag inte gör det'],
      ladder: ['Om jag inte lyssnar ringer de mottagningen.', 'Om det inte räcker bokar mottagningen hembesök.'],
      contacts: ['Mottagningen 08-123 456 78'],
    });
    const html = relativesCardHtml(card, { polarityWords: { up: 'mani' } });
    expect(html).toContain('När jag blir mani:');
    expect(html).toContain('<ol><li>Om jag inte lyssnar');
    expect(html).toContain('Ring 112');
    for (const secret of ['Tankarna går fort', 'injektioner', 'Litium']) expect(html).not.toContain(secret);
  });

  it('says so when no sign is marked as something others see', () => {
    expect(relativesCardHtml(relativesCard(emptyPlan()), { polarityWords: null })).toContain('Inga tecken är markerade');
  });
});
