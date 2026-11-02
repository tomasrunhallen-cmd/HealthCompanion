// The reviewer's 48 formulations (granskning 2 november 2026), run through the real rule.
// F: full card and red day. M: gentler card, the level is computed as usual. I: no match.
import { akutCheck } from '../src/core/context/akut';

const CASES: [string, 'F' | 'M' | 'I'][] = [
  ['Jag vill inte leva', 'F'],
  ['Jag vill inte leva längre', 'F'],
  ['Jag vet inte om jag orkar leva', 'F'],
  ['Jag vill dö', 'F'],
  ['Mår inte bra, vill dö', 'F'],
  ['Jag har självmordstankar', 'F'],
  ['Självmordsförsök i dag', 'F'],
  ['Jag känner dödslängtan', 'F'],
  ['Jag känner livsleda', 'F'],
  ['Jag är livsled', 'F'],
  ['Mina självmordstankar har blivit starkare', 'F'],
  ['Självmordstankarna skrämmer mig', 'F'],
  ['Jag vill verkligen dö', 'F'],
  ['Jag vill verkligen bara dö', 'F'],
  ['Jag vill faktiskt inte leva', 'F'],
  ['Jag vill inte dö', 'M'],
  ['Tänker inte göra mig illa', 'M'],
  ['Jag vill verkligen inte dö', 'M'],
  ['Jag ville dö i går', 'F'],
  ['Självmordsförsök för tio år sedan', 'M'],
  ['Jag läser om självmordsprevention', 'M'],
  ['Självmordsstatistiken oroar mig', 'M'],
  ['Vi hade utbildning om självmordsrisk', 'M'],
  ['Filmen handlar om självmord', 'M'],
  ['Min vän har självmordstankar', 'M'],
  ['Min mamma gjorde ett självmordsförsök', 'M'],
  ['Artikeln heter Livsleda', 'M'],
  ['Vi analyserade dödslängtan i en dikt', 'M'],
  ['Det där köpet är ekonomiskt självmord', 'M'],
  ['Jag vill dö av skratt', 'M'],
  ['Satt för mig själv', 'I'],
  ['Jag skärper mig', 'I'],
  ['Jag vill verkligen just nu dö', 'F'],
  ['Ja vill dö', 'F'],
  ['Jag vill döö', 'F'],
  ['Jag har självmordstnkar', 'F'],
  ['Jag har sjävmordstankar', 'F'],
  ['Pallar inte leva längre', 'F'],
  ['Vill inte finnas mer', 'F'],
  ['Alla skulle ha det bättre utan mig', 'F'],
  ['Jag vill inte längre sluta leva', 'F'],
  ['Jag har inga självmordstankar', 'M'],
  ['Satt för mig själv och vill dö', 'F'],
  ['Jag vill inte dö, men tänker göra mig illa', 'F'],
  ['Ja visst, jag vill dö, vilket fantastiskt möte', 'F'],
  ['Jag är dödstrött efter jobbet', 'I'],
  ['Jag vill inte leva så här, men jag vill leva', 'F'],
  ['Självmordstankar i dag; jag vill inte dö', 'F'],
];

const code = (l: 'full' | 'mild' | null) => (l === 'full' ? 'F' : l === 'mild' ? 'M' : 'I');

describe('Akutregeln mot granskarens 48 formuleringar', () => {
  it.each(CASES.map(([t, e], i) => [i + 1, t, e] as const))('%i. %s → %s', (_n, text, expected) => {
    expect(code(akutCheck(text).level)).toBe(expected);
  });

  it('marks history, other people and topics as context, and negation as negation', () => {
    expect(akutCheck('Min vän har självmordstankar').mildBecause).toBe('context');
    expect(akutCheck('Hon vill dö').mildBecause).toBe('context');
    expect(akutCheck('Jag vill inte dö').mildBecause).toBe('negation');
  });

  it('keeps the person\'s own phrases full also in a context', () => {
    expect(akutCheck('Min vän sa: jag orkar inte mer', ['orkar inte mer']).level).toBe('full');
  });

  it('a third person does not soften a clause where the person writes about themselves', () => {
    expect(akutCheck('Hon vet inte att jag vill dö').level).toBe('full');
  });
});
