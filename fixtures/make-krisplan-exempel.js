// Generates the invented example crisis plan used by the tests: the Markdown file (the
// text as it looks when copied out of a PDF, page headers and footers included), the
// answer key (facit) with the expected fields for every row, and the PDF itself.
//
//   node fixtures/make-krisplan-exempel.js          # .md and .facit.json
//   node fixtures/make-krisplan-exempel.js --pdf    # also .pdf (needs Playwright)
//
// Every name, number and address is invented. Never put a real plan in the repository.

const fs = require('fs');
const path = require('path');

const PERSON = 'Ellen Påhittad';
const PNR = '19700101-1234';
const ADDRESS = 'Testgatan 12, 123 45 Exempelstad';

// The plan, as headings and rows. `f` holds the expected fields for the row.
const sign = (severity, polarity, observer) => ({ kind: 'sign', severity, polarity, observer });
const act = (when, who, polarity = 'both', order = null) => ({ kind: 'action', when, who, polarity, ...(order ? { order } : {}) });
const of = (kind, polarity = 'both') => ({ kind, polarity });

const PLAN = [
  { h: 'Krisplan', level: 1, text: ['Upprättad 12 mars 2026 tillsammans med Mottagning Exempelstad. Planen ses över vid varje återbesök.'], textF: of('note_for_care') },
  {
    h: 'Värdeankare', level: 2,
    rows: [
      ['Jag vill vara en närvarande förälder för mina barn.', of('value_anchor')],
      ['Mitt arbete på biblioteket betyder mycket för mig.', of('value_anchor')],
      ['Jag vill behålla kontakten med mina vänner.', of('value_anchor')],
      ['Musiken och kören ger mig lugn.', of('value_anchor')],
    ],
  },
  { h: 'Risksituationer', level: 2 },
  {
    h: 'Mani', level: 3, parent: 'Risksituationer',
    rows: [
      ['Långa resor över flera tidszoner', of('trigger', 'up')],
      ['Flera nätter i rad med för lite sömn', of('trigger', 'up')],
      ['Stora projekt med hård tidspress', of('trigger', 'up')],
      ['Våren, när det blir ljust tidigt', of('trigger', 'up')],
    ],
  },
  {
    h: 'Depression', level: 3, parent: 'Risksituationer',
    rows: [
      ['De mörka månaderna november till februari', of('trigger', 'down')],
      ['Konflikter på jobbet som drar ut på tiden', of('trigger', 'down')],
      ['Långa ledigheter utan planerade aktiviteter', of('trigger', 'down')],
      ['När någon nära mig blir sjuk', of('trigger', 'down')],
    ],
  },
  { h: 'Tidiga varningstecken', level: 2 },
  {
    h: 'Tecken för omgivningen, mani', level: 3, parent: 'Tidiga varningstecken',
    rows: [
      ['Pratar fortare och avbryter ofta', sign('early', 'up', 'others')],
      ['Skämtar mer än vanligt och skrattar högt', sign('early', 'up', 'others')],
      ['Skickar många meddelanden sent på kvällen', sign('early', 'up', 'others')],
      ['Börjar flera nya projekt samtidigt', sign('early', 'up', 'others')],
      ['Klär mig mer färgglatt än vanligt', sign('early', 'up', 'others')],
    ],
  },
  {
    h: 'Egna upplevelser/tecken av mani', level: 3, parent: 'Tidiga varningstecken',
    rows: [
      ['Behöver mindre sömn men känner mig ändå pigg', sign('early', 'up', 'self')],
      ['Tankarna går fort och hoppar mellan ämnen', sign('early', 'up', 'self')],
      ['Får många idéer som känns geniala', sign('early', 'up', 'self')],
      ['Vill handla saker jag inte behöver', sign('early', 'up', 'self')],
      ['Musiken känns starkare än vanligt', sign('early', 'up', 'self')],
    ],
  },
  {
    h: 'Tecken för omgivningen, depression', level: 3, parent: 'Tidiga varningstecken',
    rows: [
      ['Svarar inte på sms eller samtal', sign('early', 'down', 'others')],
      ['Ställer in träffar i sista stund', sign('early', 'down', 'others')],
      ['Pratar tystare och mindre', sign('early', 'down', 'others')],
      ['Slutar gå till kören', sign('early', 'down', 'others')],
    ],
  },
  {
    h: 'Egna upplevelser/tecken av depression', level: 3, parent: 'Tidiga varningstecken',
    rows: [
      ['Vaknar tidigt och kan inte somna om', sign('early', 'down', 'self')],
      ['Allt känns tungt redan på morgonen', sign('early', 'down', 'self')],
      ['Orkar inte laga mat', sign('early', 'down', 'self')],
      ['Tycker att jag inte duger', sign('early', 'down', 'self')],
    ],
  },
  { h: 'Överenskomna åtgärder vid tidiga varningstecken', level: 2 },
  {
    h: 'Vad jag själv gör', level: 3, parent: 'Överenskomna åtgärder vid tidiga varningstecken', numbered: true,
    rows: [
      ['Går och lägger mig före 23 varje kväll', act('early', 'me')],
      ['Stänger av telefonen klockan 21', act('early', 'me')],
      ['Skjuter upp stora köp i minst en vecka', act('early', 'me', 'up')],
      ['Går ut i dagsljus minst en halvtimme om dagen', act('early', 'me', 'down')],
      ['Berättar för min kontaktperson hur jag mår', act('early', 'me')],
    ],
  },
  {
    h: 'Vad mina närstående gör', level: 3, parent: 'Överenskomna åtgärder vid tidiga varningstecken',
    rows: [
      ['Frågar hur jag har sovit', act('early', 'relative')],
      ['Påminner mig om planen, lugnt och utan att tjata', act('early', 'relative')],
      ['Hjälper mig att säga nej till nya åtaganden', act('early', 'relative', 'up')],
      ['Föreslår en promenad tillsammans', act('early', 'relative', 'down')],
    ],
  },
  {
    h: 'Vad mottagningen gör', level: 3, parent: 'Överenskomna åtgärder vid tidiga varningstecken',
    rows: [
      ['Erbjuder en tid inom en vecka', act('early', 'care')],
      ['Ser över medicinen tillsammans med mig', act('early', 'care')],
    ],
  },
  { h: 'Tecken som brukar tyda på allvarlig försämring', level: 2 },
  {
    h: 'Mani', level: 3, parent: 'Tecken som brukar tyda på allvarlig försämring',
    rows: [
      ['Sover mindre än fyra timmar flera nätter i rad', sign('serious', 'up', 'self')],
      ['Spenderar stora summor pengar', sign('serious', 'up', 'self')],
      ['Blir lättirriterad och arg på mina närmaste', sign('serious', 'up', 'self')],
      ['Kör bil fortare än jag brukar', sign('serious', 'up', 'self')],
    ],
    text: ['När jag är som sämst sover jag nästan inte alls, pratar oavbrutet och tror att jag har en särskild uppgift. Jag märker det oftast inte själv, så då behöver jag att andra säger det till mig.'],
    textF: sign('serious', 'up', 'self'),
  },
  {
    h: 'Depression', level: 3, parent: 'Tecken som brukar tyda på allvarlig försämring',
    rows: [
      ['Ligger kvar i sängen större delen av dagen', sign('serious', 'down', 'self')],
      ['Slutar äta ordentligt', sign('serious', 'down', 'self')],
      ['Slutar svara helt, även min familj', sign('serious', 'down', 'self')],
      // Matches the emergency rule: flagged on the phone, saved as an emergency phrase and never sent.
      ['Känner att familjen klarar sig bättre utan mig', { ...sign('serious', 'down', 'self'), akut: true }],
    ],
  },
  { h: 'Överenskomna åtgärder vid allvarlig försämring', level: 2 },
  {
    h: 'Vad jag själv gör', level: 3, parent: 'Överenskomna åtgärder vid allvarlig försämring', numbered: true,
    rows: [
      ['Ringer mottagningen samma dag', act('serious', 'me')],
      ['Tar den extra medicin som läkaren skrivit ut', act('serious', 'me')],
      ['Lämnar bankkortet till min bror', act('serious', 'me', 'up')],
      ['Stannar hemma från jobbet', act('serious', 'me')],
    ],
  },
  {
    h: 'Vad mina närstående gör', level: 3, parent: 'Överenskomna åtgärder vid allvarlig försämring',
    rows: [
      ['Ringer mottagningen om jag inte gör det själv', act('serious', 'relative')],
      ['Tar hand om barnen under några dagar', act('serious', 'relative')],
      ['Följer med mig till akutmottagningen', act('serious', 'relative')],
    ],
  },
  {
    h: 'Vad vården gör', level: 3, parent: 'Överenskomna åtgärder vid allvarlig försämring',
    rows: [
      ['Erbjuder en tid samma dag eller dagen efter', act('serious', 'care')],
      ['Bedömer om jag behöver vård på avdelning', act('serious', 'care')],
      ['Kontaktar mina närstående om jag samtycker', act('serious', 'care')],
    ],
  },
  {
    h: 'Strategier för att undvika tvångsåtgärder', level: 2, numbered: true,
    rows: [
      ['Om jag inte lyssnar på mina närstående ringer de mottagningen samma dag.', act('serious', 'relative', 'both', 1)],
      ['Om jag inte lyssnar på mottagningen bokar de ett hembesök med en sjuksköterska jag känner.', act('serious', 'care', 'both', 2)],
      ['Om jag ändå inte tar emot hjälp följer min bror med mig till akutmottagningen.', act('serious', 'relative', 'both', 3)],
      ['Om det inte räcker får vården kontakta mig via min kontaktperson innan något annat görs.', act('serious', 'care', 'both', 4)],
    ],
  },
  { h: 'Livsstil och rutiner', level: 2 },
  {
    h: 'Alltid', level: 3, parent: 'Livsstil och rutiner',
    rows: [
      ['Sömn 22:30–07:00 alla dagar, även helger', of('routine')],
      ['Tar min medicin klockan 21', of('routine')],
      ['Äter frukost, lunch och middag på fasta tider', of('routine')],
      ['Högst två koppar kaffe om dagen och inget efter 14', of('routine')],
      ['Ingen alkohol under perioder med tecken', of('routine')],
    ],
  },
  {
    h: 'Vid tecken på mani', level: 3, parent: 'Livsstil och rutiner',
    rows: [
      ['Undviker starka intryck som konserter och fester', of('routine', 'up')],
      ['Dämpar belysningen på kvällen', of('routine', 'up')],
      ['Lägger telefonen i ett annat rum på natten', of('routine', 'up')],
    ],
  },
  {
    h: 'Vid tecken på depression', level: 3, parent: 'Livsstil och rutiner',
    rows: [
      ['Planerar en sak att se fram emot varje dag', of('routine', 'down')],
      ['Rör på mig ute minst en gång om dagen', of('routine', 'down')],
      ['Träffar någon minst varannan dag', of('routine', 'down')],
    ],
  },
  {
    h: 'Kontaktuppgifter', level: 2,
    rows: [
      ['Mottagning Exempelstad, 08-123 456 78, vardagar 08.00–16.00', of('contact')],
      ['Psykiatriska akutmottagningen Exempelstad, öppen dygnet runt, 08-765 432 10', of('contact')],
      ['Kontaktperson Kim Testsson, 070-123 45 67', of('contact')],
      ['Bror Ola Påhittad, 073-765 43 21', of('contact')],
      ['Läkare Sara Exempel, nås via mottagningen', of('contact')],
    ],
  },
  {
    h: 'Patientens önskemål', level: 2,
    rows: [
      ['Jag vill att min bror kontaktas först om jag blir sämre.', of('wish')],
      ['Jag vill helst inte få injektioner.', of('wish')],
      ['Om jag behöver läggas in vill jag ha ett enkelrum om det går.', of('wish')],
      ['Jag vill att barnen får veta att jag är sjuk, inte vad jag gör.', of('wish')],
    ],
  },
  {
    h: 'Rekommendationer', level: 2,
    rows: [
      ['Litium har fungerat bra tidigare. Kontrollera nivån vid försämring.', of('note_for_care')],
      ['Bensodiazepiner har gett mig yrsel och bör undvikas.', of('note_for_care')],
      ['Jag svarar bäst på lugnt tal och korta frågor.', of('note_for_care')],
    ],
  },
  // A heading the rules do not know: these rows go to the model.
  {
    h: 'Det här hjälper mig att hitta tillbaka', level: 2,
    rows: [
      ['Långa promenader i skogen med hunden', of('routine')],
      ['Att baka bröd på söndagar', of('routine')],
      ['Ringa min syster en kväll i veckan', of('routine')],
      ['Lyssna på körens inspelningar', of('routine')],
    ],
  },
];

function renderSections() {
  // Markdown-like plain text, as copied from a PDF: headings on their own lines, "- " bullets,
  // "1. " numbered steps, paragraphs as running text.
  const lines = [];
  const facit = [];
  for (const s of PLAN) {
    lines.push('');
    lines.push(`${'#'.repeat(s.level)} ${s.h}`);
    const chain = [...(s.parent ? [s.parent] : []), s.h].filter((x) => x !== 'Krisplan');
    (s.rows ?? []).forEach(([t, f], i) => {
      lines.push(s.numbered ? `${i + 1}. ${t}` : `- ${t}`);
      facit.push({ text: t, heading: chain.join(' > '), ...f });
    });
    for (const t of s.text ?? []) {
      lines.push('');
      lines.push(t);
      facit.push({ text: t, heading: chain.join(' > '), ...s.textF });
    }
  }
  return { lines, facit };
}

function header(page, pages) {
  return [`Krisplan – ${PERSON}, ${PNR}`, ADDRESS];
}
function footer(page, pages) {
  return [`Sida ${page} av ${pages}`];
}

function writeMarkdown(dir) {
  const { lines, facit } = renderSections();
  // Three "pages": the header and footer are repeated where a PDF copy would put them.
  const body = lines.slice(1);
  const pages = 3;
  const per = Math.ceil(body.length / pages);
  const out = [];
  for (let p = 0; p < pages; p++) {
    out.push(...header(p + 1, pages), '');
    out.push(...body.slice(p * per, (p + 1) * per));
    out.push('', ...footer(p + 1, pages), '');
  }
  fs.writeFileSync(path.join(dir, 'krisplan-exempel.md'), out.join('\n'));
  fs.writeFileSync(path.join(dir, 'krisplan-exempel.facit.json'), `${JSON.stringify({ rows: facit }, null, 2)}\n`);
  return { lines, facit };
}

async function writePdf(dir, lines) {
  const { chromium } = require('playwright');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = [];
  let list = null;
  const close = () => { if (list) html.push(list === 'ol' ? '</ol>' : '</ul>'); list = null; };
  for (const l of lines) {
    const h = l.match(/^(#+) (.*)$/);
    const b = l.match(/^- (.*)$/);
    const n = l.match(/^\d+\. (.*)$/);
    if (h) { close(); html.push(`<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`); }
    else if (b) { if (list !== 'ul') { close(); html.push('<ul>'); list = 'ul'; } html.push(`<li>${esc(b[1])}</li>`); }
    else if (n) { if (list !== 'ol') { close(); html.push('<ol>'); list = 'ol'; } html.push(`<li>${esc(n[1])}</li>`); }
    else if (l.trim()) { close(); html.push(`<p>${esc(l)}</p>`); }
    else close();
  }
  close();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<html><head><meta charset="utf-8"><style>
    body { font: 11pt/1.4 Helvetica, Arial, sans-serif; } h1 { font-size: 20pt; } h2 { font-size: 15pt; margin-top: 18pt; } h3 { font-size: 12pt; }
  </style></head><body>${html.join('\n')}</body></html>`);
  const small = 'font-size:9pt; width:100%; padding: 0 15mm; font-family: Helvetica, Arial, sans-serif;';
  await page.pdf({
    path: path.join(dir, 'krisplan-exempel.pdf'),
    format: 'A4',
    margin: { top: '28mm', bottom: '22mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true,
    headerTemplate: `<div style="${small}">Krisplan – ${PERSON}, ${PNR}<br>${ADDRESS}</div>`,
    footerTemplate: `<div style="${small} text-align:right;">Sida <span class="pageNumber"></span> av <span class="totalPages"></span></div>`,
  });
  await browser.close();
  await writePdfText(dir);
}

// The text pdf.js extracts from the PDF, as the phone sees it. The tests read this file, since
// Jest cannot load pdf.js; tests/plan-import.test.ts checks that it matches the PDF's page count.
async function writePdfText(dir) {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(dir, 'krisplan-exempel.pdf'))));
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    pages.push(content.items.filter((it) => typeof it.str === 'string' && it.transform)
      .map((it) => ({ str: it.str, size: Math.round(Math.abs(it.transform[3]) * 100) / 100, x: Math.round(it.transform[4] * 100) / 100, y: Math.round(it.transform[5] * 100) / 100 })));
  }
  fs.writeFileSync(path.join(dir, 'krisplan-exempel.pdf-text.json'), `${JSON.stringify({ pages }, null, 1)}\n`);
}

if (require.main === module) {
  const dir = __dirname;
  const { lines, facit } = writeMarkdown(dir);
  console.log(`krisplan-exempel: ${facit.length} rader`);
  if (process.argv.includes('--pdf')) writePdf(dir, lines).then(() => console.log('krisplan-exempel.pdf skriven'));
}

module.exports = { PLAN, PERSON, PNR, ADDRESS, renderSections };
