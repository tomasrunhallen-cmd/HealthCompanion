// The rules table in context/krisplan-rubriker.md: which fields a heading gives its rows.
// Matched in code, without a language model. A row inherits the fields of every heading
// above it; a deeper heading overrides a shallower one field by field, and within one
// heading the longest matching pattern wins per field.

import type { Polarity, RowKind } from '../domain/types';
import { CONTEXT_SOURCES } from '../prompts/bundle.generated';
import { parseFrontmatter } from '../prompts/loader';

export interface HeadingFields {
  kind?: RowKind;
  polarity?: Polarity;
  severity?: 'early' | 'serious';
  observer?: 'self' | 'others';
  when?: 'early' | 'serious' | 'always';
  who?: 'me' | 'relative' | 'care';
  ladder?: boolean;
  special?: 'normal';
}

export interface HeadingRule {
  patterns: string[];
  level: 'huvud' | 'under';
  fields: HeadingFields;
}

export interface HintRule {
  words: string[];
  fields: HeadingFields;
}

export interface HeadingRules {
  version: string;
  headings: HeadingRule[];
  hints: HintRule[];
}

const KINDS: RowKind[] = ['sign', 'trigger', 'action', 'routine', 'contact', 'value_anchor', 'wish', 'note_for_care', 'ignore'];
const ALLOWED: Record<string, readonly string[]> = {
  kind: KINDS,
  polarity: ['up', 'down', 'both'],
  severity: ['early', 'serious'],
  observer: ['self', 'others'],
  when: ['early', 'serious', 'always'],
  who: ['me', 'relative', 'care'],
  ladder: ['ja'],
  special: ['normal'],
};

function parseFields(cell: string): HeadingFields {
  const out: Record<string, unknown> = {};
  for (const part of cell.split(/\s+/).filter(Boolean)) {
    const [key, value] = part.replace(/`/g, '').split('=');
    if (!ALLOWED[key]?.includes(value)) throw new Error(`krisplan-rubriker.md: okänt fält ${part}`);
    out[key] = key === 'ladder' ? true : value;
  }
  return out as HeadingFields;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function parseHeadingRules(source: string): HeadingRules {
  const { meta, body } = parseFrontmatter(source);
  const headings: HeadingRule[] = [];
  const hints: HintRule[] = [];
  let table: 'headings' | 'hints' | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) {
      if (line.trim()) table = null;
      continue;
    }
    const c = cells(line);
    if (/^-+$/.test(c[0].replace(/[\s:]/g, ''))) continue;
    if (c[0] === 'Mönster') { table = 'headings'; continue; }
    if (c[0] === 'Ord') { table = 'hints'; continue; }
    const patterns = c[0].split(',').map((s) => normalizeHeading(s)).filter(Boolean);
    if (table === 'headings') {
      headings.push({ patterns, level: c[1] === 'under' ? 'under' : 'huvud', fields: parseFields(c[2] ?? '') });
    } else if (table === 'hints') {
      hints.push({ words: patterns, fields: parseFields(c[1] ?? '') });
    }
  }
  return { version: String(meta.version ?? ''), headings, hints };
}

let cached: HeadingRules | null = null;
export function headingRules(): HeadingRules {
  if (!cached) {
    const src = CONTEXT_SOURCES['context/krisplan-rubriker.md'];
    if (!src) throw new Error('context/krisplan-rubriker.md saknas');
    cached = parseHeadingRules(src);
  }
  return cached;
}

/** Lower case, punctuation and list marks to spaces: "Egna upplevelser/tecken av mani:" → "egna upplevelser tecken av mani". */
export function normalizeHeading(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\s*(?:#+|\d+[.)]|[-–—•*])\s*/, '')
    .replace(/[^a-zåäöéü0-9]+/g, ' ')
    .trim();
}

/** True when the pattern's words occur in order in the heading. The last word may be inflected ("depressionen"). */
function contains(heading: string, pattern: string): boolean {
  const h = heading.split(' ');
  const p = pattern.split(' ');
  for (let i = 0; i + p.length <= h.length; i++) {
    let ok = true;
    for (let k = 0; k < p.length && ok; k++) {
      const last = k === p.length - 1;
      ok = h[i + k] === p[k] || (last && p[k].length >= 4 && h[i + k].startsWith(p[k]) && h[i + k].length - p[k].length <= 3);
    }
    if (ok) return true;
  }
  return false;
}

export interface HeadingMatch {
  fields: HeadingFields;
  /** The level from the table, used when the source does not show it. Null when no rule matched. */
  level: 'huvud' | 'under' | null;
  /** True when some rule matched. */
  known: boolean;
}

/** The fields one heading gives. The longest matching pattern wins for each field. */
export function matchHeading(heading: string, rules: HeadingRules = headingRules()): HeadingMatch {
  const h = normalizeHeading(heading);
  const best: Record<string, { len: number; value: unknown }> = {};
  let level: 'huvud' | 'under' | null = null;
  let levelLen = 0;
  for (const rule of rules.headings) {
    const hit = rule.patterns.filter((p) => contains(h, p)).sort((a, b) => b.length - a.length)[0];
    if (!hit) continue;
    for (const [k, v] of Object.entries(rule.fields)) {
      if (!best[k] || hit.length > best[k].len) best[k] = { len: hit.length, value: v };
    }
    if (hit.length > levelLen) { level = rule.level; levelLen = hit.length; }
  }
  const fields = Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.value])) as HeadingFields;
  return { fields, level, known: Object.keys(fields).length > 0 };
}

/** The fields a chain of headings gives, outermost first; deeper headings override. */
export function fieldsForChain(chain: string[], rules: HeadingRules = headingRules()): { fields: HeadingFields; known: boolean } {
  let fields: HeadingFields = {};
  let known = false;
  for (const h of chain) {
    const m = matchHeading(h, rules);
    if (m.known) known = true;
    // A new kind starts a new context: fields that belonged to the old kind do not carry over.
    if (m.fields.kind && fields.kind && m.fields.kind !== fields.kind) fields = { polarity: fields.polarity };
    fields = { ...fields, ...m.fields };
  }
  // "Anhöriga" alone: what the relatives do, whenever.
  if (!fields.kind && fields.who) fields = { ...fields, kind: 'action', when: fields.when ?? 'always' };
  return { fields, known: known && (!!fields.kind || !!fields.special) };
}

/** Who does a ladder step, from the first matching word in the row's own text. */
export function hintFromText(text: string, rules: HeadingRules = headingRules()): HeadingFields {
  for (const word of normalizeHeading(text).split(' ')) {
    for (const hint of rules.hints) if (hint.words.some((w) => contains(word, w))) return hint.fields;
  }
  return {};
}
