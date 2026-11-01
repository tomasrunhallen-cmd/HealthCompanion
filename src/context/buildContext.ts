// Puts together what the model gets to know for one day: grund + profil (at most about
// 800 tokens) + dagligt + the five latest corrections, plus today's and the week's
// measurements. Pure: it reads the context bank and the day's data and returns the text
// for the prompt variables. The prompts themselves hold no user data, only {{variables}}.
// Scrubbing of personal data happens in the matcher, on exactly these strings.

import { addDays, formatDateSv } from '../analysis/dates';
import { formatMeasurements, measuredDays } from '../analysis/measurements';
import { computeBaseline, type HistoryDay } from '../analysis/scoring';
import type {
  ContextEntry, ContextKind, DateKey, Entry, GarminDay, PlanItem, PlanItemKind, PlanSettings,
} from '../domain/types';

/** About 800 tokens at roughly four characters per token. */
export const PROFILE_BUDGET_CHARS = 3200;
const PROFILE_ENTRY_MAX_CHARS = 400;
export const CORRECTIONS_SHOWN = 5;
const EVENTS_AHEAD_DAYS = 7;
const SUMMARY_DAYS = 14;
const EMPTY = '(inget ifyllt)';

/** The prompt variables buildContext fills. The note itself is passed separately. */
export interface PromptContext {
  normallage: string;
  matvarden: string;
  grund: string;
  profil: string;
  dagligt: string;
  rattelser: string;
}

export interface BuiltContext {
  variables: PromptContext;
  /** Signs in the order they are numbered in the prompt. */
  signs: PlanItem[];
  /** Ids of the bank entries the text was built from. */
  used: string[];
}

export interface ContextDay {
  /** All entries in the context bank. */
  entries: ContextEntry[];
  /** Today's entry, or the day being tested. */
  entry: Entry;
  /** Earlier entries with levels. */
  history: HistoryDay[];
  garmin?: Record<DateKey, GarminDay>;
}

const SIGN_KINDS: PlanItemKind[] = ['early', 'serious'];

function of(entries: ContextEntry[], kind: ContextKind): ContextEntry[] {
  return entries.filter((e) => e.kind === kind).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

function bullets(list: ContextEntry[]): string[] {
  return list.map((e) => `- ${e.text}`);
}

function section(title: string, list: ContextEntry[]): string[] {
  return list.length ? [`${title}:`, ...bullets(list), ''] : [];
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The crisis plan's signs, as PlanItems, in prompt order. */
export function signsFrom(entries: ContextEntry[]): PlanItem[] {
  return entries
    .filter((e) => (SIGN_KINDS as ContextKind[]).includes(e.kind))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.order - b.order)
    .map((e) => ({ id: e.id, kind: e.kind as PlanItemKind, text: e.text, order: e.order, approvedAt: e.approvedAt, origin: e.origin }));
}

function grundText(entries: ContextEntry[], used: string[]): string {
  const parts = [
    ...section('Utlösare som personen känner till', of(entries, 'trigger')),
    ...section('Kända falsklarm (räkna dem inte som tecken)', of(entries, 'false_alarm')),
    ...section('Medicin och dosändringar', of(entries, 'medication')),
    ...section('Önskad ton vid gult', of(entries, 'tone_yellow')),
    ...section('Önskad ton vid rött', of(entries, 'tone_red')),
  ];
  for (const k of ['trigger', 'false_alarm', 'medication', 'tone_yellow', 'tone_red'] as ContextKind[]) {
    used.push(...of(entries, k).map((e) => e.id));
  }
  return parts.length ? parts.join('\n').trim() : EMPTY;
}

const PROFILE_SECTIONS: { kind: ContextKind; title: string }[] = [
  { kind: 'course', title: 'Kända förlopp' },
  { kind: 'period_high', title: 'Tidigare uppvarvade perioder' },
  { kind: 'period_low', title: 'Tidigare nedstämda perioder' },
  { kind: 'period_mixed', title: 'Tidigare blandade perioder' },
  { kind: 'typical_phrase', title: 'Typiska formuleringar på vanliga dagar' },
];

/** Most useful first; stops at the budget so the profile stays near 800 tokens. */
function profilText(entries: ContextEntry[], used: string[]): string {
  const lines: string[] = [];
  let size = 0;
  let cut = false;
  for (const { kind, title } of PROFILE_SECTIONS) {
    const list = of(entries, kind);
    if (!list.length) continue;
    const header = `${title}:`;
    if (size + header.length > PROFILE_BUDGET_CHARS) { cut = true; break; }
    lines.push(header);
    size += header.length + 1;
    for (const e of list) {
      const line = `- ${clip(e.text, PROFILE_ENTRY_MAX_CHARS)}`;
      if (size + line.length > PROFILE_BUDGET_CHARS) { cut = true; break; }
      lines.push(line);
      used.push(e.id);
      size += line.length + 1;
    }
    lines.push('');
    if (cut) break;
  }
  if (cut) lines.push('(Profilen är förkortad.)');
  return lines.length ? lines.join('\n').trim() : EMPTY;
}

function dagligtText(entries: ContextEntry[], day: ContextDay, used: string[]): string {
  const date = day.entry.date;
  const lines: string[] = [];

  const hasMedication = of(entries, 'medication').length > 0;
  const taken = of(entries, 'medication_taken').filter((e) => e.date === date).pop();
  if (taken) used.push(taken.id);
  if (hasMedication || taken) {
    lines.push(`Medicin i dag: ${taken ? (taken.taken ? 'tagen' : 'inte tagen') : 'inte angivet'}`);
  }

  const until = addDays(date, EVENTS_AHEAD_DAYS);
  const events = of(entries, 'event')
    .filter((e) => e.date != null && e.date >= date && e.date <= until)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  if (events.length) {
    lines.push('Kommande händelser som personen lagt in:');
    for (const e of events) {
      lines.push(`- ${formatDateSv(e.date!)}: ${e.text}`);
      used.push(e.id);
    }
  }

  const from = addDays(date, -SUMMARY_DAYS);
  const recent = day.history.filter((h) => h.entry.date >= from && h.entry.date < date);
  const days = new Set(recent.map((h) => h.entry.date));
  const count = (l: string) => new Set(recent.filter((h) => h.level === l).map((h) => h.entry.date)).size;
  lines.push(
    `De senaste ${SUMMARY_DAYS} dagarna: ${count('green')} gröna, ${count('yellow')} gula, ${count('red')} röda, ` +
      `${SUMMARY_DAYS - days.size} dagar utan inlägg.`,
  );
  return lines.join('\n');
}

function rattelserText(entries: ContextEntry[], signs: ContextEntry[], used: string[]): string {
  const latest = of(entries, 'correction')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, CORRECTIONS_SHOWN);
  if (!latest.length) return '(inga rättelser än)';
  used.push(...latest.map((e) => e.id));
  return latest
    .map((e) => {
      const verdict = e.correction?.verdict === 'agree' ? 'stämde' : 'stämde inte';
      const sign = signs.find((s) => s.id === e.correction?.planItemId);
      const about = sign ? ` om tecknet "${sign.text}"` : '';
      const when = e.date ? `${formatDateSv(e.date)}: ` : '';
      return `- ${when}Personen sa att bedömningen ${verdict}${about}${e.text ? `. "${e.text}"` : ''}`;
    })
    .join('\n');
}

export function buildContext(day: ContextDay, planSettings: Pick<PlanSettings, 'normalState'> | null = null): BuiltContext {
  const { entries, entry, history } = day;
  const earlier = history.filter((h) => h.entry.date < entry.date);
  const used: string[] = [];

  const normal = of(entries, 'normal_state');
  used.push(...normal.map((e) => e.id));
  const normallage = normal.map((e) => e.text).join('. ') || planSettings?.normalState || '(inte ifyllt)';

  const signEntries = entries.filter((e) => (SIGN_KINDS as ContextKind[]).includes(e.kind));
  const signs = signsFrom(entries);
  used.push(...signs.map((s) => s.id));

  return {
    signs,
    used: Array.from(new Set(used)),
    variables: {
      normallage,
      matvarden: formatMeasurements(measuredDays(entry, earlier, day.garmin), computeBaseline(entry.date, earlier).stressAvg),
      grund: grundText(entries, used),
      profil: profilText(entries, used),
      dagligt: dagligtText(entries, { ...day, history: earlier }, used),
      rattelser: rattelserText(entries, signEntries, used),
    },
  };
}

/** Context entries for code paths that only have a plan (older callers and tests). */
export function entriesFromPlan(plan: PlanItem[], normalState = ''): ContextEntry[] {
  const out: ContextEntry[] = plan.map((p) => ({
    id: p.id, layer: 'grund', kind: p.kind, text: p.text, order: p.order,
    origin: p.origin ?? 'crisis_plan', createdAt: p.approvedAt ?? '', approvedAt: p.approvedAt,
  }));
  if (normalState.trim()) {
    out.push({ id: 'normal', layer: 'profil', kind: 'normal_state', text: normalState.trim(), order: 0, origin: 'user', createdAt: '', approvedAt: '' });
  }
  return out;
}
