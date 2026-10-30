import { namesFromPlanText, scrub } from '../src/privacy/scrub';

describe('scrub', () => {
  it('removes personnummer in common formats', () => {
    expect(scrub('Mitt pnr är 19850312-1234.').text).toBe('Mitt pnr är [PERSONNUMMER].');
    expect(scrub('850312-1234').text).toBe('[PERSONNUMMER]');
    expect(scrub('198503121234').text).toBe('[PERSONNUMMER]');
  });

  it('removes Swedish phone numbers', () => {
    expect(scrub('Ring 070-123 45 67 i kväll').text).toBe('Ring [TELEFON] i kväll');
    expect(scrub('+46 70 123 45 67').text).toBe('[TELEFON]');
    expect(scrub('08-123 456 78').text).toBe('[TELEFON]');
  });

  it('removes e-mail and URLs', () => {
    expect(scrub('Mejla anna.svensson@example.se nu').text).toBe('Mejla [E-POST] nu');
    expect(scrub('Läs https://example.com/a?b=1 sen').text).toBe('Läs [LÄNK] sen');
    expect(scrub('www.1177.se').text).toBe('[LÄNK]');
  });

  it('removes street addresses and postal codes', () => {
    expect(scrub('Jag bor på Storgatan 12B').text).toBe('Jag bor på [ADRESS]');
    expect(scrub('Hemma på Björkvägen 3, lgh 1102').text).toBe('Hemma på [ADRESS]');
    expect(scrub('Adress 123 45 Malmö').text).toBe('Adress [ADRESS]');
  });

  it('removes journal terms', () => {
    expect(scrub('Låg på avd 32 förra året').text).toBe('Låg på [JOURNAL] förra året');
    expect(scrub('Patient-id: AB-1234').text).toBe('[JOURNAL]');
  });

  it('removes names from the user list, including genitive and any case', () => {
    const r = scrub('Pratade med Anna och annas mamma. Kim ringde.', ['Anna', 'Kim']);
    expect(r.text).toBe('Pratade med [NAMN] och [NAMN] mamma. [NAMN] ringde.');
    expect(r.findings.map((f) => f.original)).toEqual(['Anna', 'annas', 'Kim']);
  });

  it('does not remove a name inside another word', () => {
    expect(scrub('Kimono och Annars', ['Kim', 'Anna']).text).toBe('Kimono och Annars');
  });

  it('handles Swedish letters at word boundaries', () => {
    expect(scrub('Åsa och Örjan', ['Åsa', 'Örjan']).text).toBe('[NAMN] och [NAMN]');
  });

  it('leaves ordinary text alone', () => {
    const t = 'Sov sex timmar, jobbade 8-17 och åt middag kl 19. Mådde 6 av 10.';
    expect(scrub(t).text).toBe(t);
  });

  it('reports positions that match the original text', () => {
    const t = 'Hej Kim, ring 070-1234567';
    const r = scrub(t, ['Kim']);
    for (const f of r.findings) expect(t.slice(f.start, f.end)).toBe(f.original);
  });

  it('finds candidate names in a crisis plan', () => {
    const names = namesFromPlanText('Vid gult:\n- Ring Kim på kvällen\n- Berätta för Anna och Lars');
    expect(names).toEqual(expect.arrayContaining(['Kim', 'Anna', 'Lars']));
    expect(names).not.toContain('Ring');
  });
});
