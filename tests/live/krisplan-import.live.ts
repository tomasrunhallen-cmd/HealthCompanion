/**
 * @jest-environment node
 */
// `npm run plan:check`: runs the crisis plan import on the invented example plan against real
// models and reports accuracy against the answer key (fixtures/krisplan-exempel.facit.json).
// Not part of `npm test`, because it needs a key and costs tokens.
//
//   DAGSLJUS_LLM_PROVIDER=mistral DAGSLJUS_LLM_KEY=... \
//   DAGSLJUS_IMPORT_MODELS=mistral-small-latest,mistral-large-latest npm run plan:check
//
// Two measures per model:
//   import:     the real import. Rules first, the model only for unknown headings.
//   model only: every heading sent to the model, to see how well the model sorts on its own.
//               The example plan is invented, so sending all of it is harmless.
// The report is written to tests/live/krisplan-resultat.json.

import fs from 'node:fs';
import path from 'node:path';
import { createCompleter } from '../../src/adapter/complete';
import type { ProviderId } from '../../src/adapter/providers';
import type { RowKind } from '../../src/domain/types';
import { sortUnknownWithModel } from '../../src/plan/classify';
import { draftFromText, sortDraftWithModel } from '../../src/plan/importPlan';
import { buildAdapter } from '../../src/services/llm';
import { nodeFetch } from './nodeFetch';

jest.mock('../../src/platform/secrets', () => ({
  secretsPersist: false,
  getSecret: async () => null,
  setSecret: async () => undefined,
  deleteSecret: async () => undefined,
}));
jest.setTimeout(20 * 60 * 1000);

const FIX = path.join(__dirname, '..', '..', 'fixtures');
const markdown = fs.readFileSync(path.join(FIX, 'krisplan-exempel.md'), 'utf8');
const facit: { text: string; kind: RowKind; polarity: string; akut?: boolean }[] = JSON.parse(
  fs.readFileSync(path.join(FIX, 'krisplan-exempel.facit.json'), 'utf8'),
).rows;

const provider = (process.env.DAGSLJUS_LLM_PROVIDER ?? 'mistral') as ProviderId;
const models = (process.env.DAGSLJUS_IMPORT_MODELS ?? 'mistral-small-latest,mistral-large-latest').split(',').map((m: string) => m.trim()).filter(Boolean);

interface Score {
  rows: number;
  kindRight: number;
  polarityRight: number;
  needsSorting: number;
  byModel: number;
  wrong: { text: string; expected: string; got: string }[];
}

function score(rows: { text: string; fields: { kind: RowKind; polarity: string }; source: string; akut: boolean }[]): Score {
  const s: Score = { rows: rows.length, kindRight: 0, polarityRight: 0, needsSorting: 0, byModel: 0, wrong: [] };
  rows.forEach((r, i) => {
    const f = facit[i];
    if (r.source === 'needs') s.needsSorting++;
    if (r.source === 'model') s.byModel++;
    if (r.fields.kind === f.kind) s.kindRight++;
    else s.wrong.push({ text: r.text, expected: `${f.kind}/${f.polarity}`, got: `${r.fields.kind}/${r.fields.polarity}${r.source === 'needs' ? ' (behöver sortering)' : ''}` });
    if (r.fields.polarity === f.polarity) s.polarityRight++;
  });
  return s;
}

const pct = (n: number, d: number) => `${Math.round((1000 * n) / d) / 10} %`;

it('sorts the example plan with real models and reports accuracy against the answer key', async () => {
  const key = process.env.DAGSLJUS_LLM_KEY;
  if (!key) throw new Error('Set DAGSLJUS_LLM_KEY (and DAGSLJUS_LLM_PROVIDER, default mistral).');
  const report: Record<string, { import: Score; modelOnly: Score; failedHeadings: number }> = {};
  for (const model of models) {
    const adapter = buildAdapter({ provider, model, baseUrl: process.env.DAGSLJUS_LLM_BASE_URL ?? '' }, key, { fetch: nodeFetch });
    const completer = createCompleter(adapter);
    const draft = draftFromText(markdown);
    const real = await sortDraftWithModel(draft, completer, model, []);

    // Model only: every heading as if the rules knew none of them (emergency rows still stay on the phone).
    const all: { heading: string; ids: string[] }[] = [];
    for (const r of draft.rows) {
      if (r.akut) continue;
      const g = all.find((x) => x.heading === r.heading);
      if (g) g.ids.push(r.id); else all.push({ heading: r.heading, ids: [r.id] });
    }
    const blank = draft.rows.map((r) => ({ ...r, source: r.akut ? r.source : ('needs' as const) }));
    const only = await sortUnknownWithModel(completer, { rows: blank, unknown: all, polarityWords: {} }, []);

    report[model] = { import: score(real.draft.rows), modelOnly: score(only.rows.map((r, i) => (r.akut ? { ...r, fields: { ...r.fields, kind: facit[i].kind } } : r))), failedHeadings: real.failed + only.failed };
    const r = report[model];
    console.log(
      `${model}\n` +
      `  import:     kind ${pct(r.import.kindRight, r.import.rows)}, polarity ${pct(r.import.polarityRight, r.import.rows)}, ` +
      `${r.import.byModel} rader av modellen, ${r.import.needsSorting} behöver sortering\n` +
      `  model only: kind ${pct(r.modelOnly.kindRight, r.modelOnly.rows)}, polarity ${pct(r.modelOnly.polarityRight, r.modelOnly.rows)}, ` +
      `${r.modelOnly.needsSorting} behöver sortering\n` +
      r.modelOnly.wrong.slice(0, 15).map((w) => `    ${w.text}: väntat ${w.expected}, fick ${w.got}`).join('\n'),
    );
  }
  fs.writeFileSync(path.join(__dirname, 'krisplan-resultat.json'), `${JSON.stringify({ at: new Date().toISOString(), provider, report }, null, 2)}\n`);
  for (const model of models) expect(report[model].import.rows).toBe(facit.length);
});
