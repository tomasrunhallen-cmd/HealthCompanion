import { parseSleepHours, wordsPerMinute } from '../src/analysis/sleep';
import { draftFromText } from '../src/plan/importPlan';
import { matchSigns, wordsMatch } from '../src/analysis/wordmatch';

describe('crisis plan import without a model', () => {
  const text = `Min krisplan

Tidiga tecken
- Sover mindre än sex timmar
- Svarar inte på sms
• Handlar saker jag inte behöver

Allvarliga tecken:
1. Slutar äta
2. Känner att andra är emot mig

Vid gult
- Gå och lägg dig före 23
- Ring Kim

Vid rött
- Ring mottagningen

Anhöriga
- Fråga hur jag sover

Normalläge: sover sju timmar, jobbar dagtid`;

  it('sorts rows under headings and approves nothing by itself', () => {
    const d = draftFromText(text);
    const by = (pred: (r: (typeof d.rows)[number]) => boolean) => d.rows.filter(pred).map((r) => r.text);
    const f = (r: (typeof d.rows)[number]) => r.fields;
    expect(by((r) => f(r).kind === 'sign' && f(r).severity === 'early' && r.source === 'rules')).toEqual(['Sover mindre än sex timmar', 'Svarar inte på sms', 'Handlar saker jag inte behöver']);
    expect(by((r) => f(r).kind === 'sign' && f(r).severity === 'serious')).toEqual(['Slutar äta', 'Känner att andra är emot mig']);
    expect(by((r) => f(r).kind === 'action' && f(r).when === 'early')).toEqual(['Gå och lägg dig före 23', 'Ring Kim']);
    expect(by((r) => f(r).kind === 'action' && f(r).when === 'serious')).toEqual(['Ring mottagningen']);
    expect(by((r) => f(r).kind === 'action' && f(r).who === 'relative')).toEqual(['Fråga hur jag sover']);
    expect(by((r) => r.special === 'normal')).toEqual(['sover sju timmar', 'jobbar dagtid']);
    expect(by((r) => r.source === 'needs')).toEqual(['Min krisplan']);
    expect(d.rows.every((r) => !r.approved)).toBe(true);
  });
});

describe('sleep from the note', () => {
  it.each([
    ['Sov fyra timmar i natt', 4],
    ['sov typ 5,5 h', 5.5],
    ['Jag sov bara tre och en halv timme', 3.5],
    ['fick 6 timmars sömn', 6],
    ['har sovit 7 timmar', 7],
    ['Sov dåligt', null],
    ['Jobbade sex timmar', null],
  ])('%s -> %s', (text, expected) => {
    expect(parseSleepHours(text)).toBe(expected);
  });
});

describe('words per minute', () => {
  it('needs a real recording', () => {
    expect(wordsPerMinute('ett två tre fyra fem sex', 3)).toBeNull();
    expect(wordsPerMinute(Array(60).fill('ord').join(' '), 30)).toBe(120);
  });
});

describe('word matching', () => {
  it('matches inflections but not unrelated short words', () => {
    expect(wordsMatch('svarar', 'svara')).toBe(true);
    expect(wordsMatch('handlar', 'handlade')).toBe(true);
    expect(wordsMatch('sms', 'sm')).toBe(false);
    expect(wordsMatch('äta', 'äter')).toBe(false); // too short to stem safely; keeps false positives down
  });

  it('keeps negations so "svarar på sms" does not match "svarar inte på sms"', () => {
    const plan = [{ id: 's', kind: 'early' as const, text: 'Svarar inte på sms', order: 0, approvedAt: '' }];
    expect(matchSigns('Svarade på alla sms i dag.', plan)).toEqual([]);
    expect(matchSigns('Svarade inte på några sms.', plan)).toHaveLength(1);
  });
});
