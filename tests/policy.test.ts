import { readFileSync } from 'fs';
import { join } from 'path';
import { MEDICAL_REMINDER, PRIVACY_POLICY_URL } from '../src/legal';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { markdownToHtml, page } = require('../scripts/build-policy.js');
const policy = readFileSync(join(__dirname, '..', 'INTEGRITETSPOLICY.md'), 'utf8');

describe('the privacy policy page (App Store Review Guidelines 5.1.1)', () => {
  it('says what is handled, where it goes, the third parties, how long, and how to revoke and delete', () => {
    for (const heading of ['Vilka uppgifter appen hanterar', 'Var uppgifterna finns', 'När något lämnar telefonen', 'Hur länge uppgifterna sparas', 'Dina val', 'Vem som ansvarar']) {
      expect(policy).toContain(`## ${heading}`);
    }
    for (const words of ['Koppla bort språkmodellen', 'Radera allt', 'ingen reklam', 'ingen spårning', 'Apple Hälsa']) expect(policy).toContain(words);
  });

  it('reminds people to talk to a doctor, as the app does (1.4.1)', () => {
    expect(policy).toContain('Prata med din läkare eller vårdkontakt innan du fattar beslut om din behandling.');
    expect(MEDICAL_REMINDER).toContain('Prata med din läkare eller vårdkontakt');
  });

  it('becomes a standalone HTML page served from the site', () => {
    const html = page(policy);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<h1>Integritetspolicy för Dagsljus</h1>');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(PRIVACY_POLICY_URL).toBe('https://dagsljus.netlify.app/integritet.html');
  });

  it('turns the policy\'s small Markdown into HTML and escapes everything else', () => {
    expect(markdownToHtml('## Rubrik\n\nEn **fet** rad <b>.\n\n- ett\n- två')).toBe(
      '<h2>Rubrik</h2>\n<p>En <strong>fet</strong> rad &lt;b&gt;.</p>\n<ul>\n<li>ett</li>\n<li>två</li>\n</ul>',
    );
  });
});
