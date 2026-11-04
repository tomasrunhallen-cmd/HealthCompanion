// Reading the yearly CSV report of another mood diary ("Bipolär dagbok", 365-dagarsrapport).
// One row per day: date, weekday, two mood fields, medication, many yes/no columns and a
// free-text note. A day that was not filled in has "-" in every field. Pure functions.

import type { DateKey } from '../core/domain/types';

export const SOURCE_NAME = 'Bipolär dagbok';

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6, juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

export const COL_DATE = 'Datum';
export const COL_DAY = 'Dag';
export const COL_NOTE = 'Anteckningar';
export const COL_HIGH = 'Högt Humör';
export const COL_LOW = 'Lågt Humör';
export const COL_MEDICATION = 'Medicin';
export const COL_ALCOHOL = 'Alkohol';
const REQUIRED = [COL_DATE, COL_HIGH, COL_LOW, COL_MEDICATION, COL_NOTE];

/** RFC 4180: quoted fields may hold commas, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** "03 november 2020" to "2020-11-03". Null when it is not such a date. */
export function parseSwedishDate(s: string): DateKey | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})$/);
  if (!m || !MONTHS[m[2]]) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2]];
  const year = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface DiaryDay {
  date: DateKey;
  /** Every column except date, weekday and note, by trimmed column name. "-" means not filled in. */
  values: Record<string, string>;
  /** The note, with "-" read as empty. */
  note: string;
}

export interface ParsedFile {
  name: string;
  days: DiaryDay[];
  /** Days where nothing was filled in. */
  empty: number;
  /** Rows whose date could not be read. */
  skipped: number;
}

/** True when the header is the diary's report. */
export function isDiaryReport(header: string[]): boolean {
  const cols = header.map((c) => c.trim());
  return REQUIRED.every((c) => cols.includes(c));
}

export function parseDiaryFile(name: string, text: string): ParsedFile {
  const rows = parseCsv(text);
  if (!rows.length || !isDiaryReport(rows[0])) {
    throw new Error(`${name} ser inte ut som en rapport från ${SOURCE_NAME}. Första raden ska börja med Datum, Dag, Högt Humör.`);
  }
  const header = rows[0].map((c) => c.trim());
  const out: ParsedFile = { name, days: [], empty: 0, skipped: 0 };
  for (const r of rows.slice(1)) {
    const cell = (c: string) => (r[header.indexOf(c)] ?? '').trim();
    const date = parseSwedishDate(cell(COL_DATE));
    if (!date) {
      out.skipped++;
      continue;
    }
    const values: Record<string, string> = {};
    header.forEach((c, i) => {
      if (c && c !== COL_DATE && c !== COL_DAY && c !== COL_NOTE) values[c] = (r[i] ?? '').trim();
    });
    const rawNote = cell(COL_NOTE);
    const note = rawNote === '-' ? '' : (r[header.indexOf(COL_NOTE)] ?? '').replace(/\r\n/g, '\n').trim();
    const filled = note !== '' || Object.values(values).some((v) => v !== '-' && v !== '');
    if (!filled) {
      out.empty++;
      continue;
    }
    out.days.push({ date, values, note });
  }
  return out;
}

export interface DiaryImport {
  days: DiaryDay[];
  files: { name: string; days: number; empty: number; skipped: number; from: DateKey | null; to: DateKey | null }[];
  /** The same date in more than one file: the first file's day is kept. */
  duplicates: number;
}

/** Several yearly files into one list of days, oldest first. */
export function parseDiaryFiles(files: { name: string; text: string }[]): DiaryImport {
  const byDate = new Map<DateKey, DiaryDay>();
  let duplicates = 0;
  const summary: DiaryImport['files'] = [];
  for (const f of files) {
    const p = parseDiaryFile(f.name, f.text);
    const dates = p.days.map((d) => d.date).sort();
    summary.push({ name: f.name, days: p.days.length, empty: p.empty, skipped: p.skipped, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null });
    for (const d of p.days) {
      if (byDate.has(d.date)) duplicates++;
      else byDate.set(d.date, d);
    }
  }
  return { days: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)), files: summary, duplicates };
}

// ---- reading the values ----

const NEUTRAL = new Set(['', '-', 'NEJ', 'Balanserad']);

/**
 * What the day says, as items the user can link to a sign: each yes/no column answered
 * "JA" ("Ångest"), and each mood value other than "Balanserad" ("Lågt Humör: Nedstämdhet").
 * Medication and alcohol have their own fixed meaning and are not listed.
 */
export function signalsOf(day: DiaryDay): string[] {
  const out: string[] = [];
  for (const [col, v] of Object.entries(day.values)) {
    if (col === COL_MEDICATION || col === COL_ALCOHOL || NEUTRAL.has(v)) continue;
    out.push(col === COL_HIGH || col === COL_LOW ? `${col}: ${v}` : col);
  }
  return out;
}

/**
 * The diary's mood fields on Dagsljus's scale from −3 to +3 (analysis/mood.ts). The diary has
 * three steps down and two up, and no acute step on either side: its strongest word,
 * "Depression", is Dagsljus's Depression (−2), not Akut depression (−3), which weighs as a
 * serious sign. "Mild Depression" is −2 as well. A low value wins over a high one on days with
 * both, since the low side is what the plan most often acts on.
 */
export const MOOD_VALUES: Record<string, number> = {
  [`${COL_LOW}: Depression`]: -2,
  [`${COL_LOW}: Mild Depression`]: -2,
  [`${COL_LOW}: Nedstämdhet`]: -1,
  [`${COL_HIGH}: Glädje`]: 1,
  [`${COL_HIGH}: Uppvarvning`]: 2,
};
export const MOOD_BALANCED = 0;

export function moodOf(day: DiaryDay): number | null {
  const low = day.values[COL_LOW];
  const high = day.values[COL_HIGH];
  if ((!low || low === '-') && (!high || high === '-')) return null;
  const lowValue = low && !NEUTRAL.has(low) ? MOOD_VALUES[`${COL_LOW}: ${low}`] : undefined;
  if (lowValue != null) return lowValue;
  const highValue = high && !NEUTRAL.has(high) ? MOOD_VALUES[`${COL_HIGH}: ${high}`] : undefined;
  return highValue ?? MOOD_BALANCED;
}

/** "JA" true, "NEJ" false, anything else unanswered. */
export function medicationOf(day: DiaryDay): boolean | null {
  const v = day.values[COL_MEDICATION];
  return v === 'JA' ? true : v === 'NEJ' ? false : null;
}

export function alcoholOf(day: DiaryDay): boolean {
  return day.values[COL_ALCOHOL] === 'JA';
}

/**
 * Hours of sleep from the note's "Sömn:" line: "ca 7 h", "7:30 h", "7.5-8 h", "8+ h",
 * "6 h 45 min". Only that line is read, so other hours in the note are not taken for sleep.
 * Values under 3 hours are left out.
 */
export function sleepFromNote(note: string): number | null {
  for (const line of note.split('\n')) {
    if (!/^\s*sömn\s*:/i.test(line)) continue;
    const m = line
      .toLowerCase()
      .match(/(\d{1,2}(?:[.,:]\d{1,2})?)(?:\s*[-–]\s*(\d{1,2}(?:[.,]\d{1,2})?))?\s*\+?\s*(?:h|tim|timmar|timme)\b(?:\s*(\d{1,2})\s*min)?/);
    if (!m) continue;
    const read = (s: string) => {
      if (s.includes(':')) {
        const [h, mm] = s.split(':').map(Number);
        return h + mm / 60;
      }
      return Number(s.replace(',', '.'));
    };
    let hours = read(m[1]);
    if (m[2]) hours = (hours + read(m[2])) / 2;
    if (m[3]) hours += Number(m[3]) / 60;
    // Below 3 hours a figure on the line is more often time awake than sleep; Garmin is used for those nights.
    if (hours >= 3 && hours <= 16) return Math.round(hours * 100) / 100;
  }
  return null;
}
