// Export and import of the context bank as three markdown files: grund.md, profil.md and
// dagligt.md. Readable for a person: one heading per kind, one bullet per entry. Each
// bullet carries an HTML comment with the fields needed to restore it exactly, so export
// followed by import gives an identical bank. A bullet added by hand, without a comment,
// is imported as the user's own entry under the kind of its heading.

import { formatDateSv } from '../analysis/dates';
import { LAYER_OF, type ContextEntry, type ContextKind, type ContextLayer } from '../domain/types';
import { KIND_TEXT, LAYER_TEXT, ORIGIN_TEXT } from './labels';
import { fieldsFromKind } from '../plan/fields';

export const CONTEXT_FILES: Record<ContextLayer, string> = { grund: 'grund.md', profil: 'profil.md', dagligt: 'dagligt.md' };

const KIND_ORDER: ContextKind[] = [
  'value_anchor', 'early', 'serious', 'action_yellow', 'action_red', 'relatives', 'akut', 'trigger', 'routine', 'contact',
  'wish', 'note_for_care', 'false_alarm', 'medication',
  'tone_yellow', 'tone_red', 'normal_state', 'course', 'period_high', 'period_low', 'period_mixed', 'typical_phrase',
  'event', 'medication_taken', 'routine_done', 'red_step', 'correction',
];

const MARK = 'dagsljus';

/**
 * The context files' schema (B6). Written in every exported file; a file without it is
 * schema 1. Files from older schemas are migrated forward when they are read.
 *   1: before the crisis plan rows had fields.
 *   2: grund rows carry their fields (plan), routines their settings, days their routine answers.
 */
export const CONTEXT_SCHEMA = 2;
const SCHEMA_MARK = `${MARK}-schema`;

/** Forward migrations, one per schema step: MIGRATIONS[1] takes an entry from schema 1 to 2. */
const MIGRATIONS: Record<number, (e: ContextEntry) => ContextEntry> = {
  1: (e) => (e.layer === 'grund' && !e.plan && fieldsFromKind(e.kind) ? { ...e, plan: fieldsFromKind(e.kind) } : e),
};

export function migrateEntries(entries: ContextEntry[], from: number): ContextEntry[] {
  let out = entries;
  for (let v = from; v < CONTEXT_SCHEMA; v++) out = out.map(MIGRATIONS[v]);
  return out;
}
const EMPTY_TEXT = '(ingen text)';

/** Everything but the text, which is the bullet itself. */
function meta(e: ContextEntry): Record<string, unknown> {
  const { text, layer: _layer, ...rest } = e;
  return text === '' ? { ...rest, empty: true } : rest;
}

function humanNote(e: ContextEntry): string {
  const bits = [ORIGIN_TEXT[e.origin]];
  if (e.origin === 'standard' && !e.approvedAt) bits.push('inte bekräftad');
  if (e.date) bits.push(formatDateSv(e.date));
  if (e.kind === 'medication_taken') bits.push(e.taken ? 'tagen' : 'inte tagen');
  if (e.kind === 'routine_done' || e.kind === 'red_step') bits.push(e.done ? 'gjord' : 'inte gjord');
  if (e.kind === 'correction') bits.push(e.correction?.verdict === 'agree' ? 'stämde' : 'stämde inte');
  return bits.join(', ');
}

export function exportLayer(layer: ContextLayer, entries: ContextEntry[], now = new Date(), extra?: string): string {
  const own = entries.filter((e) => e.layer === layer);
  const lines: string[] = [
    `# ${LAYER_TEXT[layer].title}`,
    `<!-- ${SCHEMA_MARK} ${CONTEXT_SCHEMA} -->`,
    '',
    `${LAYER_TEXT[layer].help} Exporterad från Dagsljus ${formatDateSv(now.toISOString().slice(0, 10))}.`,
    '',
    'Du kan ändra texten i punkterna. Kommentarerna (<!-- ... -->) behövs för att filen ska kunna importeras igen exakt.',
    'Nya punkter utan kommentar importeras som dina egna under rubriken de står.',
    '',
  ];
  for (const kind of KIND_ORDER) {
    const list = own.filter((e) => e.kind === kind).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
    if (!list.length) continue;
    lines.push(`## ${KIND_TEXT[kind]}`, '');
    for (const e of list) {
      const [first, ...more] = (e.text === '' ? EMPTY_TEXT : e.text).split('\n');
      lines.push(`- ${first}`);
      for (const m of more) lines.push(`  ${m}`);
      lines.push(`  _${humanNote(e)}_`);
      lines.push(`  <!-- ${MARK} ${JSON.stringify(meta(e))} -->`);
    }
    lines.push('');
  }
  if (!own.length) lines.push('_Inga poster._', '');
  if (extra) lines.push('## Räknas fram ur anteckningarna (importeras inte)', '', ...extra.split('\n').map((l) => `> ${l}`), '');
  return lines.join('\n');
}

export function exportAll(entries: ContextEntry[], now = new Date(), dagligtSummary?: string): Record<string, string> {
  return {
    [CONTEXT_FILES.grund]: exportLayer('grund', entries, now),
    [CONTEXT_FILES.profil]: exportLayer('profil', entries, now),
    [CONTEXT_FILES.dagligt]: exportLayer('dagligt', entries, now, dagligtSummary),
  };
}

export interface ParsedLayer {
  layer: ContextLayer;
  entries: ContextEntry[];
  /** The schema the file was written with, before migration. */
  fromSchema: number;
}

const LAYER_BY_TITLE: Record<string, ContextLayer> = Object.fromEntries(
  (Object.keys(LAYER_TEXT) as ContextLayer[]).map((l) => [LAYER_TEXT[l].title.toLowerCase(), l]),
);
const KIND_BY_HEADING: Record<string, ContextKind> = Object.fromEntries(
  (Object.keys(KIND_TEXT) as ContextKind[]).map((k) => [KIND_TEXT[k].toLowerCase(), k]),
);

let n = 0;
function newId(): string {
  n = (n + 1) % 1_000_000;
  return `c_${Date.now().toString(36)}_${n.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Reads one exported file. Throws in Swedish when the file is not a Dagsljus context file. */
export function parseLayer(markdown: string, now = new Date()): ParsedLayer {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const title = lines.find((l) => /^#\s+/.test(l))?.replace(/^#\s+/, '').trim().toLowerCase() ?? '';
  const layer = LAYER_BY_TITLE[title];
  if (!layer) throw new Error('Filen är inte en exporterad kontextfil från Dagsljus (Grund, Profil eller Dagligt).');
  const schemaLine = lines.map((l) => l.match(new RegExp(`^<!--\\s*${SCHEMA_MARK}\\s+(\\d+)\\s*-->$`))).find(Boolean);
  const fromSchema = schemaLine ? Number(schemaLine[1]) : 1;
  if (fromSchema > CONTEXT_SCHEMA) throw new Error('Filen kommer från en nyare version av Dagsljus. Uppdatera appen och försök igen.');

  const entries: ContextEntry[] = [];
  let kind: ContextKind | null = null;
  let current: { text: string[]; meta: Record<string, unknown> | null } | null = null;
  const stamp = now.toISOString();
  const flush = () => {
    if (!current || !kind) {
      current = null;
      return;
    }
    const m = current.meta;
    const text = m?.empty ? '' : current.text.join('\n').trim();
    if (m && typeof m.id === 'string' && typeof m.kind === 'string') {
      const k = m.kind as ContextKind;
      if (LAYER_OF[k] !== layer) throw new Error(`Posten ${m.id} hör inte till ${LAYER_TEXT[layer].title}.`);
      const { empty: _e, ...rest } = m;
      entries.push({ ...(rest as Omit<ContextEntry, 'text' | 'layer'>), layer, text } as ContextEntry);
    } else if (text && LAYER_OF[kind] === layer) {
      const order = entries.filter((e) => e.kind === kind).reduce((mx, e) => Math.max(mx, e.order + 1), 0);
      const plan = layer === 'grund' ? fieldsFromKind(kind) : null;
      entries.push({ id: newId(), layer, kind, text, order, origin: 'user', createdAt: stamp, approvedAt: stamp, ...(plan ? { plan } : {}) });
    }
    current = null;
  };

  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      flush();
      kind = KIND_BY_HEADING[h[1].toLowerCase()] ?? null;
      continue;
    }
    const bullet = line.match(/^- (.*)$/);
    if (bullet) {
      flush();
      current = { text: [bullet[1] === EMPTY_TEXT ? '' : bullet[1]], meta: null };
      continue;
    }
    if (!current) continue;
    const c = line.match(new RegExp(`^\\s*<!--\\s*${MARK}\\s+(\\{.*\\})\\s*-->\\s*$`));
    if (c) {
      try {
        current.meta = JSON.parse(c[1]);
      } catch {
        throw new Error('En kommentar i filen är skadad och går inte att läsa.');
      }
      continue;
    }
    if (/^\s+_.*_\s*$/.test(line)) continue; // the readable note under each bullet
    if (/^ {2}/.test(line)) current.text.push(line.slice(2));
    else if (!line.trim()) continue;
    else flush();
  }
  flush();
  return { layer, entries: migrateEntries(entries, fromSchema), fromSchema };
}
