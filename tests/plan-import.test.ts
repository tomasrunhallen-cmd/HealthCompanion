// The crisis plan import on a realistic, invented plan (fixtures/krisplan-exempel.*):
// page headers, the heading tree, the rules table, the model only for unknown headings,
// validation and fallback, the review that never moves a card, saving and migration.

import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { createCompleter } from '../src/core/llm/complete';
import { fixedAdapter } from '../src/core/llm/fake';
import type { LlmAdapter, SendRequest } from '../src/core/llm/types';
import type { RowKind } from '../src/core/domain/types';
import { answerErrors } from '../src/core/plan/classify';
import { fieldsFromKind } from '../src/core/plan/fields';
import { headingRules, matchHeading } from '../src/core/plan/headingRules';
import {
  approveHeading, draftFromPages, draftFromText, reviewSections, sleepWindowIn, sortDraftWithModel, updateRow, windowHours, type PlanDraft,
} from '../src/core/plan/importPlan';
import { saveApprovedRows } from '../src/services/savePlan';
import { linesFromDocx, linesFromPdfItems, linesFromText } from '../src/core/plan/source';
import { emptySnapshot, memoryBackend } from '../src/storage/backend';
import { Repository, SCHEMA_VERSION } from '../src/storage/repository';

const DIR = path.join(__dirname, '..', 'fixtures');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PLAN, PNR, ADDRESS, PERSON } = require('../fixtures/make-krisplan-exempel.js');

interface FacitRow {
  text: string;
  heading: string;
  kind: RowKind;
  polarity: string;
  severity?: string;
  observer?: string;
  when?: string;
  who?: string;
  order?: number;
  akut?: boolean;
}
const facit: FacitRow[] = JSON.parse(fs.readFileSync(path.join(DIR, 'krisplan-exempel.facit.json'), 'utf8')).rows;
const markdown = fs.readFileSync(path.join(DIR, 'krisplan-exempel.md'), 'utf8');
const pdfText: { pages: { str: string; size: number; x: number; y: number }[][] } = JSON.parse(
  fs.readFileSync(path.join(DIR, 'krisplan-exempel.pdf-text.json'), 'utf8'),
);

/** The same invented plan as a .docx: heading styles, Word lists, and the header in its own part. */
function exampleDocx(): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const p = (text: string, extra = '') => `<w:p><w:pPr>${extra}</w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  const body: string[] = [p('Krisplan', '<w:pStyle w:val="Heading1"/>')];
  for (const s of PLAN as { h: string; level: number; numbered?: boolean; rows?: [string][]; text?: string[] }[]) {
    if (s.h !== 'Krisplan') body.push(p(s.h, `<w:pStyle w:val="Heading${s.level}"/>`));
    for (const [t] of s.rows ?? []) body.push(p(t, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${s.numbered ? 2 : 1}"/></w:numPr>`));
    for (const t of s.text ?? []) body.push(p(t));
  }
  const numbering = `<w:numbering xmlns:w="w">
    <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  return zipSync({
    'word/document.xml': strToU8(`<w:document xmlns:w="w"><w:body>${body.join('')}</w:body></w:document>`),
    'word/numbering.xml': strToU8(numbering),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="w">${p(`Krisplan – ${PERSON}, ${PNR}`)}${p(ADDRESS)}</w:hdr>`),
  });
}

const SOURCES: [string, () => PlanDraft][] = [
  ['inklistrad text', () => draftFromPages(linesFromText(markdown), 'text')],
  ['PDF', () => draftFromPages(linesFromPdfItems(pdfText.pages), 'pdf')],
  ['Word', () => { const d = linesFromDocx(exampleDocx()); return draftFromPages(d.pages, 'docx', { furniture: d.furniture }); }],
];

/** Answers like a careful model would, from the answer key, for the ids it is sent. */
function facitAdapter(draft: PlanDraft): LlmAdapter & { calls: SendRequest[] } {
  const index = new Map(draft.rows.map((r, i) => [r.id, i]));
  const calls: SendRequest[] = [];
  return {
    provider: 'fake', model: 'facit', local: true, calls,
    async send(req) {
      calls.push(req);
      const ids = req.user.split('\n').filter((l) => l.startsWith('{"id"')).map((l) => (JSON.parse(l) as { id: string }).id);
      const rows = ids.map((id) => ({ id, kind: facit[index.get(id)!].kind, polarity: facit[index.get(id)!].polarity }));
      return { text: JSON.stringify({ rows }), usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

describe('the example plan', () => {
  it('is invented, has at least 90 rows and the structure of a real plan', () => {
    expect(facit.length).toBeGreaterThanOrEqual(90);
    expect(PNR).toBe('19700101-1234');
    const headings = new Set(facit.map((r) => r.heading.split(' > ')[0]));
    for (const h of ['Tidiga varningstecken', 'Tecken som brukar tyda på allvarlig försämring', 'Risksituationer', 'Strategier för att undvika tvångsåtgärder', 'Livsstil och rutiner', 'Patientens önskemål', 'Rekommendationer', 'Värdeankare']) {
      expect(headings).toContain(h);
    }
    expect(pdfText.pages.length).toBeGreaterThanOrEqual(3);
  });
});

describe.each(SOURCES)('import from %s', (_label, make) => {
  const draft = make();

  it('removes the page header and footer on every page and never keeps them in a row', () => {
    const all = draft.rows.map((r) => `${r.heading} ${r.text}`).join('\n');
    expect(all).not.toContain(PNR);
    expect(all).not.toContain('Testgatan');
    expect(all).not.toMatch(/Sida \d+ av \d+/);
    expect(draft.removed.join(' ')).toContain(PNR);
    expect(draft.removed.join(' ')).toContain('Testgatan 12');
  });

  it('puts every row under the right heading, in the plan\'s order', () => {
    expect(draft.title).toBe('Krisplan');
    expect(draft.rows.map((r) => [r.heading, r.text])).toEqual(facit.map((f) => [f.heading, f.text]));
  });

  it('sorts at least 90 % of the rows by the rules, without a model, and gets their kinds right', () => {
    const byRules = draft.rows.filter((r) => r.source === 'rules');
    expect(byRules.length / draft.rows.length).toBeGreaterThanOrEqual(0.9);
    const wrong = draft.rows.map((r, i) => ({ r, f: facit[i] })).filter(({ r, f }) => r.source === 'rules' && r.fields.kind !== f.kind);
    expect(wrong.map(({ r }) => r.text)).toEqual([]);
    // Severity, observer, when, who and the ladder come from the headings too.
    for (const [i, r] of draft.rows.entries()) {
      if (r.source !== 'rules') continue;
      const f = facit[i];
      if (f.kind === 'sign') expect([r.text, r.fields.severity, r.fields.observer]).toEqual([f.text, f.severity, f.observer]);
      if (f.kind === 'action') expect([r.text, r.fields.when, r.fields.who, r.fields.order ?? null]).toEqual([f.text, f.when, f.who, f.order ?? null]);
    }
  });

  it('flags the emergency row and never sends it', () => {
    const akut = draft.rows.filter((r) => r.akut).map((r) => r.text);
    expect(akut).toEqual(facit.filter((f) => f.akut).map((f) => f.text));
  });
});

describe('the model, only for unknown headings', () => {
  it('sorts 100 % of the rows with a model that answers correctly, one heading at a time', async () => {
    const draft = draftFromText(markdown);
    expect(draft.unknown.map((g) => g.heading)).toEqual(['', 'Det här hjälper mig att hitta tillbaka']);
    const fake = facitAdapter(draft);
    const { draft: sorted, failed } = await sortDraftWithModel(draft, createCompleter(fake), 'facit', ['Kim']);
    expect(failed).toBe(0);
    expect(fake.calls).toHaveLength(2);
    expect(sorted.rows.filter((r) => r.source === 'needs')).toEqual([]);
    expect(sorted.rows.map((r) => r.fields.kind)).toEqual(facit.map((f) => f.kind));
    // The model's answer never changes a row's text.
    expect(sorted.rows.map((r) => r.text)).toEqual(draft.rows.map((r) => r.text));
    expect(sorted.model).toBe('facit');
  });

  it('sends no personnummer, address, emergency row, wish or note for the care', async () => {
    const draft = draftFromText(markdown);
    const fake = facitAdapter(draft);
    await sortDraftWithModel(draft, createCompleter(fake), 'facit', []);
    const sent = fake.calls.map((c) => `${c.system}\n${c.user}`).join('\n');
    expect(sent).not.toMatch(/\d{6}-\d{4}/);
    expect(sent).not.toContain('Testgatan');
    expect(sent).not.toContain('123 45');
    expect(sent).not.toContain(PERSON);
    for (const f of facit.filter((x) => x.akut || ['wish', 'note_for_care', 'contact', 'sign', 'action'].includes(x.kind) && x.heading)) {
      expect(sent).not.toContain(f.text);
    }
  });

  it('keeps every row and marks them "Behöver din sortering" when the answer is broken twice', async () => {
    const draft = draftFromText(markdown);
    const fake = fixedAdapter(['inte json {', '{"rows": [']);
    const { draft: after, failed } = await sortDraftWithModel(draft, createCompleter(fake), 'trasig', []);
    expect(failed).toBe(2);
    expect(fake.calls).toHaveLength(4); // one retry per heading
    expect(fake.calls[1].errorFeedback).toMatch(/schemat/);
    expect(after.rows.map((r) => r.text)).toEqual(facit.map((f) => f.text));
    const unknownIds = new Set(draft.unknown.flatMap((g) => g.ids));
    for (const r of after.rows.filter((x) => unknownIds.has(x.id))) {
      expect([r.source, r.fields.kind, r.fields.severity, r.fields.polarity]).toEqual(['needs', 'sign', 'early', 'both']);
    }
    expect(after.model).toBeNull();
  });

  it('retries with the error attached when ids are unknown or missing', async () => {
    const draft = draftFromText('Det här hjälper mig\n- Baka bröd\n- Ringa min syster');
    const ids = draft.unknown[0].ids;
    expect(answerErrors({ rows: [{ id: 'x9', kind: 'routine', polarity: 'both' }] }, ids)).toEqual(['okänt id x9', `rader saknas: ${ids.join(', ')}`]);
    const good = JSON.stringify({ rows: ids.map((id) => ({ id, kind: 'routine', polarity: 'both' })) });
    const fake = fixedAdapter([JSON.stringify({ rows: [{ id: 'x9', kind: 'routine', polarity: 'both' }] }), good]);
    const { draft: after } = await sortDraftWithModel(draft, createCompleter(fake), 'm', []);
    expect(fake.calls[1].errorFeedback).toContain('okänt id x9');
    expect(after.rows.map((r) => [r.fields.kind, r.source])).toEqual([['routine', 'model'], ['routine', 'model']]);
  });
});

describe('the review (A1: a changed kind never moves a card)', () => {
  it('keeps the card in place with the same id and text when the kind is switched back and forth three times', () => {
    let draft = draftFromText(markdown);
    const target = draft.rows.find((r) => r.text === 'Frågar hur jag har sovit')!;
    const where = (d: PlanDraft) => {
      const { sections } = reviewSections(d);
      const s = sections.findIndex((x) => x.rows.some((r) => r.id === target.id));
      return { s, i: sections[s].rows.findIndex((r) => r.id === target.id), heading: sections[s].heading, order: d.rows.map((r) => r.id) };
    };
    const before = where(draft);
    for (let n = 0; n < 3; n++) {
      for (const kind of ['sign', 'action'] as RowKind[]) {
        draft = updateRow(draft, target.id, { fields: { ...draft.rows.find((r) => r.id === target.id)!.fields, kind }, touched: true });
        expect(where(draft)).toEqual(before);
        const row = draft.rows.find((r) => r.id === target.id)!;
        expect([row.id, row.text, row.fields.kind]).toEqual([target.id, target.text, kind]);
      }
    }
  });

  it('lists the rows that need sorting first and counts per heading', () => {
    const { needs, sections } = reviewSections(draftFromText(markdown));
    expect(needs.map((r) => r.heading)).toEqual(['', 'Det här hjälper mig att hitta tillbaka', 'Det här hjälper mig att hitta tillbaka', 'Det här hjälper mig att hitta tillbaka', 'Det här hjälper mig att hitta tillbaka']);
    const early = sections.find((s) => s.heading === 'Tidiga varningstecken > Tecken för omgivningen, mani')!;
    expect(early.count).toEqual({ total: 5, rules: 5, model: 0, needs: 0, approved: 0 });
  });

  it('approves every row under one heading', () => {
    const d = approveHeading(draftFromText(markdown), 'Värdeankare');
    expect(d.rows.filter((r) => r.approved).map((r) => r.heading)).toEqual(Array(4).fill('Värdeankare'));
  });
});

describe('the rules table', () => {
  it('parses context/krisplan-rubriker.md and lets the longest pattern win per field', () => {
    const rules = headingRules();
    expect(rules.version).toBe('1.1.0');
    expect(rules.headings.length).toBeGreaterThan(15);
    expect(matchHeading('Överenskomna åtgärder vid allvarlig försämring').fields).toMatchObject({ kind: 'action', when: 'serious' });
    expect(matchHeading('Tecken som brukar tyda på allvarlig försämring').fields).toMatchObject({ kind: 'sign', severity: 'serious' });
    expect(matchHeading('Egna upplevelser/tecken av mani').fields).toEqual({ observer: 'self', polarity: 'up' });
    expect(matchHeading('Depressionen').fields).toEqual({ polarity: 'down' });
    expect(matchHeading('Det här hjälper mig att hitta tillbaka').known).toBe(false);
  });

  it('takes the plan\'s own words for the directions from its headings', () => {
    expect(draftFromText(markdown).polarityWords).toEqual({ up: 'mani', down: 'depression' });
    expect(draftFromText('Tidiga tecken\n- Sover lite').polarityWords).toEqual({});
  });
});

describe('the sleep window', () => {
  it('finds "Sömn 22:30–07:00" in the routines and counts its hours', () => {
    const draft = draftFromText(markdown);
    expect(sleepWindowIn(draft.rows)).toEqual({ start: '22:30', end: '07:00', text: 'Sömn 22:30–07:00 alla dagar, även helger' });
    expect(windowHours('22:30', '07:00')).toBe(8.5);
    expect(sleepWindowIn(draft.rows.filter((r) => r.fields.kind === 'sign'))).toBeNull();
  });
});

describe('saving the reviewed plan', () => {
  it('saves only approved rows, with their fields, and clears the draft', async () => {
    const repo = await Repository.create(memoryBackend());
    let draft = draftFromText(markdown);
    for (const h of ['Värdeankare', 'Tecken som brukar tyda på allvarlig försämring > Depression', 'Strategier för att undvika tvångsåtgärder', 'Patientens önskemål']) {
      draft = approveHeading(draft, h);
    }
    await repo.kvSet('planImportDraft', draft);
    const sum = await saveApprovedRows(repo, draft);
    expect(sum).toEqual({ saved: 15, akut: 1, normal: 0 });
    const grund = repo.contextEntries('grund');
    expect(grund.filter((e) => e.kind === 'value_anchor')).toHaveLength(4);
    expect(grund.filter((e) => e.kind === 'wish')).toHaveLength(4);
    expect(grund.find((e) => e.kind === 'akut')?.text).toBe('Känner att familjen klarar sig bättre utan mig');
    const ladder = grund.filter((e) => e.plan?.order).sort((a, b) => a.plan!.order! - b.plan!.order!);
    expect(ladder.map((e) => [e.kind, e.plan!.who, e.plan!.order])).toEqual([
      ['relatives', 'relative', 1], ['action_red', 'care', 2], ['relatives', 'relative', 3], ['action_red', 'care', 4],
    ]);
    const serious = grund.filter((e) => e.kind === 'serious');
    expect(serious.map((e) => e.plan)).toEqual(Array(3).fill(expect.objectContaining({ kind: 'sign', severity: 'serious', polarity: 'down', sourceHeading: 'Tecken som brukar tyda på allvarlig försämring > Depression' })));
    expect(repo.planSettings().polarityWords).toEqual({ up: 'mani', down: 'depression' });
    expect(repo.kvGet('planImportDraft')).toBeNull();
  });
});

describe('migration to the row fields (schema 3)', () => {
  it('gives every grund entry its fields from its old kind, with polarity both', async () => {
    const s = emptySnapshot();
    const at = '2026-10-01T10:00:00.000Z';
    const entry = (id: string, kind: string) => ({ id, layer: 'grund', kind, text: id, order: 0, origin: 'crisis_plan', createdAt: at, approvedAt: at });
    s.grund = { e: entry('e', 'early'), s: entry('s', 'serious'), y: entry('y', 'action_yellow'), r: entry('r', 'action_red'), a: entry('a', 'relatives'), k: entry('k', 'akut') } as never;
    s.kv.schemaVersion = 2;
    const repo = await Repository.create(memoryBackend(s));
    const by = Object.fromEntries(repo.contextEntries('grund').map((e) => [e.id, e.plan ?? null]));
    expect(by).toEqual({
      e: { kind: 'sign', polarity: 'both', severity: 'early', observer: 'self' },
      s: { kind: 'sign', polarity: 'both', severity: 'serious', observer: 'self' },
      y: { kind: 'action', polarity: 'both', when: 'early', who: 'me', order: null },
      r: { kind: 'action', polarity: 'both', when: 'serious', who: 'me', order: null },
      a: { kind: 'action', polarity: 'both', when: 'always', who: 'relative', order: null },
      k: null,
    });
    expect(repo.kvGet('schemaVersion')).toBe(SCHEMA_VERSION);
    expect(fieldsFromKind('trigger')).toEqual({ kind: 'trigger', polarity: 'both' });
  });
});
