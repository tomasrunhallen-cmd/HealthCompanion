// Context words count only where they can mean the past, someone else or a topic (akut list
// 0.6.0, after the external review of 15 November 2026). Both kinds of error are tested: a
// statement about oneself made mild by a word elsewhere in the sentence, and a story about
// someone else or the past made full.
// F: full card and red day. M: gentler card. I: no match.
import { akutCheck } from '../src/core/context/akut';

const CASES: [string, 'F' | 'M' | 'I'][] = [
  // About oneself, now: full, whatever else the sentence mentions.
  ['Jag vill dö och min vän vet om det', 'F'],
  ['Jag vill dö. Min vän vet om det', 'F'],
  ['Min mamma vet inte att jag vill dö', 'F'],
  ['Jag har självmordstankar och min partner är orolig', 'F'],
  ['Läste en bok i dag men jag vill dö', 'F'],
  ['Jag vill dö precis som för tio år sedan', 'F'],
  ['Han vet att jag vill dö', 'F'],
  ['Jag vill dö precis som i filmen', 'F'],
  // About someone else, the past or a topic: gentler card.
  ['Min vän vill dö', 'M'],
  ['Min vän sa att hon vill dö', 'M'],
  ['Min vän har självmordstankar', 'M'],
  ['Min mamma gjorde ett självmordsförsök', 'M'],
  ['Jag såg en film där hon vill dö', 'M'],
  ['För tio år sedan ville jag dö', 'M'],
  ['Jag ville dö för tio år sedan', 'M'],
  ['Självmordsförsök för tio år sedan', 'M'],
  ['Som tonåring hade jag självmordstankar', 'M'],
  ['Filmen handlar om självmord', 'M'],
  ['Jag läser om självmordsprevention', 'M'],
  ['Vi hade utbildning om självmordsrisk', 'M'],
  ['Det där köpet är ekonomiskt självmord', 'M'],
  ['Jag vill dö av skratt', 'M'],
  // A negation still gives the gentler card, also with a context word after it.
  ['Jag vill inte dö och min vän vet om det', 'M'],
  // No hit.
  ['Min vän och jag gick på bio', 'I'],
];

describe('context words count where they stand', () => {
  for (const [note, want] of CASES) {
    it(`${want}: ${note}`, () => {
      const level = akutCheck(note).level;
      expect(level === 'full' ? 'F' : level === 'mild' ? 'M' : 'I').toBe(want);
    });
  }
});
