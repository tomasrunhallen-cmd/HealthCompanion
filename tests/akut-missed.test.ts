// Formulations the independent review of 14 November 2026 found the rule missed (list 0.5.0),
// with the everyday sentences next to them that must still give nothing.
// F: full card and red day. M: gentler card. I: no match.
import { akutCheck } from '../src/core/context/akut';

const CASES: [string, 'F' | 'M' | 'I'][] = [
  ['Jag ska skada mig', 'F'],
  ['Jag vill bara skada mig', 'F'],
  ['Tänker skada mig i kväll', 'F'],
  ['Har skurit mig i dag', 'F'],
  ['Jag har skadat mig själv igen', 'F'],
  ['Har skrivit ett avskedsbrev', 'F'],
  ['Avskedsbrevet ligger på bordet', 'F'],
  ['Jag har samlat tabletter', 'F'],
  ['Har sparat tabletter i lådan', 'F'],
  ['Vill somna och aldrig vakna', 'F'],
  ['Jag vill inte vakna igen', 'F'],
  ['Önskar att jag fick somna in för gott', 'F'],
  ['Tänker ta en överdos', 'F'],
  ['Jag funderar på att hänga mig', 'F'],
  ['Tänker hoppa från bron', 'F'],
  ['I want to die', 'F'],
  ['I want to kill myself', 'F'],
  ['Thinking I should end my life', 'F'],
  ['I will hurt myself', 'F'],
  // A negation still gives the gentler card.
  ['Jag ska inte skada mig', 'M'],
  ['Jag vill inte skada mig', 'M'],
  // Everyday sentences with the same words.
  ['Jag skadade mig i knät på träningen', 'I'],
  ['Det kan inte skada mig att vila', 'I'],
  ['Vaknade aldrig av väckarklockan i morse', 'I'],
  ['Trodde aldrig jag skulle orka vakna så tidigt', 'I'],
  ['Tog mina tabletter som vanligt', 'I'],
  ['Hoppade från bryggan och badade', 'I'],
  ['Skrev ett brev till mormor', 'I'],
  ['Jag vill somna tidigt i kväll', 'I'],
];

describe('the formulations the review found missing', () => {
  for (const [note, want] of CASES) {
    it(`${want}: ${note}`, () => {
      const level = akutCheck(note).level;
      expect(level === 'full' ? 'F' : level === 'mild' ? 'M' : 'I').toBe(want);
    });
  }
});
