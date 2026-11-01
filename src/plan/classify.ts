// Sorts the plan's rows: first by the rules table, in code. Only rows under headings the
// table does not know go to a language model, one heading at a time, scrubbed. The model
// answers with an id, a kind and a polarity per row and never with text of its own. An
// answer that does not hold is retried once with the error attached; if that also fails,
// the rows are left for the person to sort ("Behöver din sortering").

import type { Completer } from '../adapter/types';
import { akutLevel } from '../context/akut';
import type { PlanFields, Polarity, RowKind } from '../domain/types';
import { loadPrompt } from '../prompts/loader';
import { scrub } from '../privacy/scrub';
import { ROW_KINDS, normalizeFields } from './fields';
import { fieldsForChain, headingRules, hintFromText, normalizeHeading, type HeadingRules } from './headingRules';
import type { PlanRow } from './tree';

export type RowSource = 'rules' | 'model' | 'needs';

export interface DraftPlanRow {
  id: string;
  text: string;
  /** The text as it stands in the plan, to tell whether the person has changed it. */
  original: string;
  /** The plan's heading chain, "Tidiga varningstecken > Mani". Empty for rows before the first heading. */
  heading: string;
  parentId: string | null;
  fields: PlanFields;
  /** Normalläge: kept as the person's own description of the normal state. */
  special: 'normal' | null;
  /** About not wanting to live or self-harm: saved as the person's own emergency phrase, never sent. */
  akut: boolean;
  source: RowSource;
  approved: boolean;
  /** The person has changed a field. The row stays where it is; only the confirmation changes. */
  touched?: boolean;
}

export const NEEDS_SORTING_FIELDS: PlanFields = { kind: 'sign', polarity: 'both', severity: 'early', observer: 'self' };

const CONTACT_FINDINGS = new Set(['telefon', 'epost']);

function hasContactDetails(text: string): boolean {
  return scrub(text).findings.some((f) => CONTACT_FINDINGS.has(f.kind));
}

export interface RuleResult {
  rows: DraftPlanRow[];
  /** Rows under headings the table does not know, by heading, in plan order. Not yet sorted. */
  unknown: { heading: string; ids: string[] }[];
  /** The plan's own words for the two directions, from its headings ("mani", "depression"). */
  polarityWords: { up?: string; down?: string };
}

/** The word in a heading that gave a direction, as the plan writes it. */
function directionWord(heading: string, rules: HeadingRules): { dir: 'up' | 'down'; word: string } | null {
  const words = normalizeHeading(heading).split(' ');
  for (const rule of rules.headings) {
    const dir = rule.fields.polarity;
    if (dir !== 'up' && dir !== 'down') continue;
    for (const p of rule.patterns) {
      if (p.includes(' ')) continue;
      const w = words.find((x) => x === p || (x.startsWith(p) && x.length - p.length <= 3));
      if (w) return { dir, word: p };
    }
  }
  return null;
}

/** Step 5: fields from the headings. Rows under unknown headings are marked for step 6. */
export function classifyByRules(rows: PlanRow[], rules: HeadingRules = headingRules()): RuleResult {
  const out: DraftPlanRow[] = [];
  const unknown: RuleResult['unknown'] = [];
  const polarityWords: RuleResult['polarityWords'] = {};
  const ladderPos = new Map<string, number>();

  for (const row of rows) {
    const heading = row.headings.join(' > ');
    for (const h of row.headings) {
      const d = directionWord(h, rules);
      if (d && !polarityWords[d.dir]) polarityWords[d.dir] = d.word;
    }
    const { fields: hf, known } = fieldsForChain(row.headings, rules);
    const base = { id: row.id, text: row.text, original: row.text, heading, parentId: row.parentId, approved: false };
    const akut = akutLevel(row.text) != null;

    if (known) {
      if (hf.special === 'normal') {
        out.push({ ...base, fields: { kind: 'note_for_care', polarity: 'both' }, special: 'normal', akut, source: 'rules' });
        continue;
      }
      const f: PlanFields = { kind: hf.kind!, polarity: hf.polarity ?? 'both', sourceHeading: heading || undefined };
      if (f.kind === 'sign') {
        f.severity = hf.severity ?? 'early';
        f.observer = hf.observer ?? 'self';
      }
      if (f.kind === 'action') {
        f.when = hf.when ?? 'always';
        f.who = hf.who ?? 'me';
        if (hf.ladder && !row.parentId) {
          const pos = (ladderPos.get(heading) ?? 0) + 1;
          ladderPos.set(heading, pos);
          f.order = row.number ?? pos;
          // The heading does not say who takes the step; the row's own words do.
          if (!hf.who) f.who = hintFromText(row.text, rules).who ?? 'me';
        } else f.order = null;
      }
      out.push({ ...base, fields: normalizeFields(f), special: null, akut, source: 'rules' });
      continue;
    }

    // Unknown heading. A row with a phone number or e-mail is a contact, decided in code.
    if (hasContactDetails(row.text)) {
      out.push({ ...base, fields: { kind: 'contact', polarity: 'both', sourceHeading: heading || undefined }, special: null, akut, source: 'rules' });
      continue;
    }
    out.push({ ...base, fields: { ...NEEDS_SORTING_FIELDS, sourceHeading: heading || undefined }, special: null, akut, source: 'needs' });
    if (akut) continue; // emergency rows are never sent
    const group = unknown.find((g) => g.heading === heading);
    if (group) group.ids.push(row.id);
    else unknown.push({ heading, ids: [row.id] });
  }
  return { rows: out, unknown, polarityWords };
}

// ---- step 6 and 7: the model, for unknown headings only ----

interface ModelRow {
  id: string;
  kind: RowKind;
  polarity: Polarity;
}

/** Checks the answer against the ids that were sent: every id once, nothing else. */
export function answerErrors(json: unknown, ids: string[]): string[] {
  const rows = (json as { rows?: ModelRow[] })?.rows;
  if (!Array.isArray(rows)) return ['rows saknas'];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!ids.includes(r.id)) errors.push(`okänt id ${r.id}`);
    else if (seen.has(r.id)) errors.push(`id ${r.id} finns två gånger`);
    seen.add(r.id);
    if (!ROW_KINDS.includes(r.kind)) errors.push(`ogiltig kind ${r.kind} för ${r.id}`);
    if (!['up', 'down', 'both'].includes(r.polarity)) errors.push(`ogiltig polarity ${r.polarity} för ${r.id}`);
  }
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length) errors.push(`rader saknas: ${missing.join(', ')}`);
  return errors;
}

export interface SortRequest {
  heading: string;
  rows: { id: string; text: string }[];
}

/** What is sent for one heading: scrubbed heading and rows, with their ids. */
export function sortVariables(req: SortRequest, names: string[]): { rubrik: string; rader: string } {
  return {
    rubrik: req.heading ? scrub(req.heading, names).text : '(ingen rubrik)',
    rader: req.rows.map((r) => JSON.stringify({ id: r.id, text: scrub(r.text, names).text })).join('\n'),
  };
}

export interface ModelSortResult {
  rows: DraftPlanRow[];
  /** Headings the model sorted, and headings that ended as "Behöver din sortering". */
  sorted: number;
  failed: number;
  errors: string[];
}

/** Sends each unknown heading to the model and applies the answers. Rows that fail stay as "needs". */
export async function sortUnknownWithModel(
  completer: Completer,
  result: RuleResult,
  names: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<ModelSortResult> {
  const byId = new Map(result.rows.map((r) => [r.id, r]));
  const prompt = loadPrompt('krisplan-sortera');
  let sorted = 0;
  let failed = 0;
  const errors: string[] = [];
  let done = 0;
  for (const group of result.unknown) {
    const req: SortRequest = { heading: group.heading, rows: group.ids.map((id) => ({ id, text: byId.get(id)!.text })) };
    try {
      const res = await completer.complete(prompt, sortVariables(req, names), { check: (json) => answerErrors(json, group.ids) });
      for (const r of (res.json as { rows: ModelRow[] }).rows) {
        const row = byId.get(r.id)!;
        byId.set(r.id, {
          ...row,
          fields: normalizeFields({ kind: r.kind, polarity: r.polarity, sourceHeading: row.fields.sourceHeading }),
          source: 'model',
        });
      }
      sorted++;
    } catch (e) {
      failed++;
      errors.push((e as Error).message);
    }
    onProgress?.(++done, result.unknown.length);
  }
  return { rows: result.rows.map((r) => byId.get(r.id)!), sorted, failed, errors };
}
