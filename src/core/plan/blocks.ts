// The crisis plan as text blocks, one per heading, with roughly the same headings for every
// patient. The person writes or pastes the text under each heading, in their own words; the
// rows the app needs (signs for the scoring, routines to tick off, the steps in Hjälp nu) are
// made from the blocks in code: one row per line. The block is what the person reads,
// writes and approves; the rows are never edited one by one.

import type { PlanFields, Polarity } from '../domain/types';
import { akutLevel } from '../context/akut';
import { hintFromText } from './headingRules';
import { normalizeFields } from './fields';

export type BlockType =
  | 'value_anchor' | 'normal' | 'routine' | 'routine_up' | 'routine_down' | 'trigger'
  | 'early_up' | 'early_down' | 'early'
  | 'action_early' | 'relatives_early'
  | 'serious_up' | 'serious_down' | 'serious'
  | 'action_serious' | 'others_serious' | 'ladder'
  | 'contacts' | 'wishes' | 'care' | 'ignore';

export interface BlockTemplate {
  type: BlockType;
  heading: string;
  /** What to write here, shown when the block is empty. */
  hint: string;
  /** Shown in the template the person fills in. Generic types appear only from an import. */
  inTemplate: boolean;
}

/** The template, in the order a crisis plan is usually read. */
export const TEMPLATE: BlockTemplate[] = [
  { type: 'value_anchor', heading: 'Värdeankare – det som är viktigt för mig', hint: 'Det som gör att du vill ta hand om dig. Visas ordagrant vid rött.', inTemplate: true },
  { type: 'normal', heading: 'Mitt normalläge', hint: 'Hur du är när du mår som vanligt: sömn, arbete, umgänge.', inTemplate: true },
  { type: 'routine', heading: 'Livsstil och rutiner – varje dag', hint: 'Dina grundrutiner, en per rad, till exempel ”Sömn 22:30–07:00”. Du bockar av dem under dagen.', inTemplate: true },
  { type: 'trigger', heading: 'Risksituationer', hint: 'Situationer som brukar göra dig sämre, en per rad.', inTemplate: true },
  { type: 'early_up', heading: 'Tidiga varningstecken – uppvarvning', hint: 'Ett tecken per rad, med dina egna ord.', inTemplate: true },
  { type: 'early_down', heading: 'Tidiga varningstecken – nedstämdhet', hint: 'Ett tecken per rad, med dina egna ord.', inTemplate: true },
  { type: 'routine_up', heading: 'Livsstil och rutiner vid uppvarvning', hint: 'Det du gör mer av eller håller hårdare i när tecknen pekar uppåt, en sak per rad.', inTemplate: true },
  { type: 'routine_down', heading: 'Livsstil och rutiner vid nedstämdhet', hint: 'Det du gör när tecknen pekar nedåt, en sak per rad.', inTemplate: true },
  { type: 'action_early', heading: 'Det här gör jag vid tidiga tecken', hint: 'Dina steg, i ordning. Det första är ditt första steg.', inTemplate: true },
  { type: 'relatives_early', heading: 'Det här gör mina närstående vid tidiga tecken', hint: 'Vad du vill att de gör, en sak per rad.', inTemplate: true },
  { type: 'serious_up', heading: 'Tecken på allvarlig försämring – uppvarvning', hint: 'Ett tecken per rad.', inTemplate: true },
  { type: 'serious_down', heading: 'Tecken på allvarlig försämring – nedstämdhet', hint: 'Ett tecken per rad.', inTemplate: true },
  { type: 'action_serious', heading: 'Det här gör jag vid allvarlig försämring', hint: 'Dina steg, i ordning.', inTemplate: true },
  { type: 'others_serious', heading: 'Det här gör närstående och vården vid allvarlig försämring', hint: 'En sak per rad. Skriv vem som gör det.', inTemplate: true },
  { type: 'ladder', heading: 'Strategier för att undvika tvångsåtgärder', hint: 'Stegen i ordning: om jag inte …, då …', inTemplate: true },
  { type: 'contacts', heading: 'Kontakter', hint: 'Mottagning, kontaktperson och närstående med telefonnummer. Skickas aldrig till en språkmodell.', inTemplate: true },
  { type: 'wishes', heading: 'Mina önskemål', hint: 'Hur du vill bli bemött och vårdad. Skickas aldrig till en språkmodell.', inTemplate: true },
  { type: 'care', heading: 'Till vården', hint: 'Mediciner, vad som fungerat och vad som inte gjort det. Skickas aldrig till en språkmodell.', inTemplate: true },
  { type: 'early', heading: 'Tidiga varningstecken', hint: 'Ett tecken per rad.', inTemplate: false },
  { type: 'serious', heading: 'Tecken på allvarlig försämring', hint: 'Ett tecken per rad.', inTemplate: false },
  { type: 'ignore', heading: 'Sparas inte', hint: '', inTemplate: false },
];

export const BLOCK_TEXT: Record<BlockType, string> = Object.fromEntries(TEMPLATE.map((t) => [t.type, t.heading])) as Record<BlockType, string>;

export interface PlanBlock {
  id: string;
  type: BlockType;
  /** The plan's own heading, or the template's. */
  heading: string;
  /** The person's own text, exactly as written: one thing per line. */
  text: string;
  /** Only for sign blocks: the person's own experience, or what others can see. */
  observer?: 'self' | 'others';
  updatedAt: string;
}

const SIGN: Partial<Record<BlockType, { severity: 'early' | 'serious'; polarity: Polarity }>> = {
  early_up: { severity: 'early', polarity: 'up' },
  early_down: { severity: 'early', polarity: 'down' },
  early: { severity: 'early', polarity: 'both' },
  serious_up: { severity: 'serious', polarity: 'up' },
  serious_down: { severity: 'serious', polarity: 'down' },
  serious: { severity: 'serious', polarity: 'both' },
};

/** The fields every row of a block gets. Null for blocks that make no rows. */
export function blockFields(block: Pick<PlanBlock, 'type' | 'observer' | 'heading'>): PlanFields | null {
  const sourceHeading = block.heading;
  const sign = SIGN[block.type];
  if (sign) return { kind: 'sign', polarity: sign.polarity, severity: sign.severity, observer: block.observer ?? 'self', sourceHeading };
  switch (block.type) {
    case 'value_anchor': return { kind: 'value_anchor', polarity: 'both', sourceHeading };
    case 'routine': return { kind: 'routine', polarity: 'both', sourceHeading };
    case 'routine_up': return { kind: 'routine', polarity: 'up', sourceHeading };
    case 'routine_down': return { kind: 'routine', polarity: 'down', sourceHeading };
    case 'trigger': return { kind: 'trigger', polarity: 'both', sourceHeading };
    case 'action_early': return { kind: 'action', polarity: 'both', when: 'early', who: 'me', order: null, sourceHeading };
    case 'relatives_early': return { kind: 'action', polarity: 'both', when: 'early', who: 'relative', order: null, sourceHeading };
    case 'action_serious': return { kind: 'action', polarity: 'both', when: 'serious', who: 'me', order: null, sourceHeading };
    case 'others_serious': return { kind: 'action', polarity: 'both', when: 'serious', who: 'relative', order: null, sourceHeading };
    case 'ladder': return { kind: 'action', polarity: 'both', when: 'serious', who: 'relative', order: 1, sourceHeading };
    case 'contacts': return { kind: 'contact', polarity: 'both', sourceHeading };
    case 'wishes': return { kind: 'wish', polarity: 'both', sourceHeading };
    case 'care': return { kind: 'note_for_care', polarity: 'both', sourceHeading };
    default: return null;
  }
}

/** Sign blocks, where the observer choice applies. */
export function isSignBlock(type: BlockType): boolean {
  return !!SIGN[type];
}

const MARK = /^\s*(?:[-–—•*·●▪]|(\d{1,2})[.)])\s+/;

/**
 * The block's lines as rows: one per line, list marks removed. A line that starts in lower
 * case continues the line before (text wrapped when pasted). Blank lines only separate.
 */
export function blockLines(text: string): { text: string; number: number | null }[] {
  const out: { text: string; number: number | null }[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const m = raw.match(MARK);
    const line = raw.replace(MARK, '').trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    if (!m && prev && /^[a-zåäö]/.test(line)) prev.text = `${prev.text} ${line}`;
    else out.push({ text: line, number: m?.[1] ? Number(m[1]) : null });
  }
  return out;
}

export interface BlockRow {
  text: string;
  fields: PlanFields;
  /** About not wanting to live or self-harm: saved as the person's own emergency phrase. */
  akut: boolean;
}

/** The rows a block makes. Actions keep their order; in a ladder the line's words say who acts. */
export function rowsFromBlock(block: PlanBlock): BlockRow[] {
  const base = blockFields(block);
  if (!base) return [];
  return blockLines(block.text).map((line, i) => {
    let fields: PlanFields = { ...base };
    if (block.type === 'ladder') fields = { ...fields, order: line.number ?? i + 1, who: hintFromText(line.text).who ?? 'me' };
    else if (block.type === 'others_serious') fields = { ...fields, who: hintFromText(line.text).who ?? 'relative' };
    return { text: line.text, fields: normalizeFields(fields), akut: akutLevel(line.text) != null };
  });
}

/** The template's empty blocks for a new plan. */
export function emptyPlan(now = new Date()): PlanBlock[] {
  return TEMPLATE.filter((t) => t.inTemplate).map((t) => ({ id: `b_${t.type}`, type: t.type, heading: t.heading, text: '', updatedAt: now.toISOString() }));
}

/** The block type that fits a row's fields, for an imported plan's headings. */
export function typeFromFields(f: PlanFields | null, special: 'normal' | null = null): BlockType | null {
  if (special === 'normal') return 'normal';
  if (!f) return null;
  const dir = f.polarity === 'up' ? '_up' : f.polarity === 'down' ? '_down' : '';
  switch (f.kind) {
    case 'sign': return `${f.severity === 'serious' ? 'serious' : 'early'}${dir}` as BlockType;
    case 'routine': return dir ? (`routine${dir}` as BlockType) : 'routine';
    case 'trigger': return 'trigger';
    case 'value_anchor': return 'value_anchor';
    case 'contact': return 'contacts';
    case 'wish': return 'wishes';
    case 'note_for_care': return 'care';
    case 'ignore': return 'ignore';
    case 'action':
      if (f.order != null) return 'ladder';
      if (f.when === 'serious') return f.who === 'me' ? 'action_serious' : 'others_serious';
      return f.who === 'me' ? 'action_early' : 'relatives_early';
  }
}

/** The whole plan as text, in template order, for reading and for the files the person shares. */
export function planAsText(blocks: PlanBlock[]): string {
  return orderBlocks(blocks)
    .filter((b) => b.text.trim() && b.type !== 'ignore')
    .map((b) => `${b.heading}\n${blockLines(b.text).map((l) => `- ${l.text}`).join('\n')}`)
    .join('\n\n');
}

const ORDER = new Map(TEMPLATE.map((t, i) => [t.type, i]));

/** Template order; blocks of the same type keep the order they were given. */
export function orderBlocks(blocks: PlanBlock[]): PlanBlock[] {
  return blocks.map((b, i) => ({ b, i })).sort((x, y) => (ORDER.get(x.b.type)! - ORDER.get(y.b.type)!) || x.i - y.i).map((x) => x.b);
}

// ---- from an imported plan ----

/** A block made from an imported plan. Null type: the heading is unknown and the person chooses. */
export interface ImportedBlock extends Omit<PlanBlock, 'type'> {
  type: BlockType | null;
}

/**
 * Groups an imported plan's rows by their heading into blocks, in the plan's order. The type
 * comes from the rules table's reading of the heading; rows under an unknown heading make a
 * block without type, for the person to choose.
 */
export function blocksFromRows(
  rows: { heading: string; text: string; parentId: string | null; fields: PlanFields; special: 'normal' | null; source: string }[],
  now = new Date(),
): ImportedBlock[] {
  const out: ImportedBlock[] = [];
  for (const r of rows) {
    const heading = r.heading ? r.heading.split(' > ').join(' – ') : 'Utan rubrik';
    let b = out.find((x) => x.heading === heading);
    if (!b) {
      const type = r.source === 'needs' ? null : typeFromFields(r.fields, r.special);
      b = {
        id: `b_${out.length + 1}_${now.getTime().toString(36)}`,
        type,
        heading,
        text: '',
        updatedAt: now.toISOString(),
        ...(r.fields.kind === 'sign' && r.fields.observer === 'others' ? { observer: 'others' as const } : {}),
      };
      out.push(b);
    }
    b.text = b.text ? `${b.text}\n${r.parentId ? '  ' : ''}${r.text}` : r.text;
  }
  return out;
}

// ---- an updated plan (Uppdaterad plan) ----

export interface BlockChange {
  heading: string;
  type: BlockType;
  status: 'new' | 'removed' | 'changed' | 'same';
  added: string[];
  removed: string[];
  kept: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-zåäöéü0-9]+/g, ' ').trim();

/** The difference between the plan as saved and the new one, block by block and line by line. */
export function diffPlans(old: PlanBlock[], next: PlanBlock[]): BlockChange[] {
  const used = new Set<string>();
  const match = (b: PlanBlock) =>
    old.find((o) => !used.has(o.id) && o.type === b.type && norm(o.heading) === norm(b.heading)) ??
    old.find((o) => !used.has(o.id) && o.type === b.type);
  const out: BlockChange[] = [];
  for (const b of orderBlocks(next)) {
    if (b.type === 'ignore') continue;
    const o = match(b);
    if (o) used.add(o.id);
    const before = o ? blockLines(o.text).map((l) => l.text) : [];
    const after = blockLines(b.text).map((l) => l.text);
    const beforeN = new Set(before.map(norm));
    const afterN = new Set(after.map(norm));
    const added = after.filter((l) => !beforeN.has(norm(l)));
    const removed = before.filter((l) => !afterN.has(norm(l)));
    if (!after.length && !before.length) continue;
    out.push({
      heading: b.heading,
      type: b.type,
      status: !o || !before.length ? (after.length ? 'new' : 'same') : added.length || removed.length ? 'changed' : 'same',
      added,
      removed,
      kept: after.length - added.length,
    });
  }
  for (const o of old) {
    if (used.has(o.id) || !blockLines(o.text).length) continue;
    out.push({ heading: o.heading, type: o.type, status: 'removed', added: [], removed: blockLines(o.text).map((l) => l.text), kept: 0 });
  }
  return out;
}
