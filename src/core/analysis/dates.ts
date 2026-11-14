import type { DateKey, Entry } from '../domain/types';
import { RULES } from './rules';

/**
 * The day runs from 04:00 to 04:00 in local time (rules/rules.json, dayStartHour). An entry
 * at 00:30 belongs to the day before. Local time follows the phone, so daylight saving time
 * and travel are handled by the clock where the entry is made.
 */
export const DAY_START_HOUR = RULES.dayStartHour;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The day (04:00–04:00, local time) a moment belongs to. */
export function eveningDateKey(d: Date): DateKey {
  if (d.getHours() < DAY_START_HOUR) {
    const prev = new Date(d);
    prev.setDate(prev.getDate() - 1);
    return toDateKey(prev);
  }
  return toDateKey(d);
}

export function parseDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: DateKey, b: DateKey): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function formatDateSv(key: DateKey): string {
  const d = parseDateKey(key);
  const days = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
  const months = [
    'januari', 'februari', 'mars', 'april', 'maj', 'juni',
    'juli', 'augusti', 'september', 'oktober', 'november', 'december',
  ];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

/** Same as formatDateSv, with only the first letter capitalised. */
export function formatDateSvTitle(key: DateKey): string {
  const s = formatDateSv(key);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "1 augusti 2025": for periods that span years. */
export function formatDateSvYear(key: DateKey): string {
  const [y, m, d] = key.split('-').map(Number);
  const months = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Like formatDateSvTitle, with the year added when it is not this year (imported days go back years). */
export function formatDateSvTitleYear(key: DateKey, now = new Date()): string {
  const s = formatDateSvTitle(key);
  return key.slice(0, 4) === String(now.getFullYear()) ? s : `${s} ${key.slice(0, 4)}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "HH:MM" on the phone's clock at `d`. Saved with an entry so a later time zone never changes it. */
export function localClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The clock time an entry was made, where it was made: the saved local time, or for entries
 * saved before it existed, the timestamp read in the phone's current time zone.
 */
export function entryClock(entry: Pick<Entry, 'createdAt' | 'localTime'>): { hour: number; minute: number } {
  const t = entry.localTime ?? formatTime(entry.createdAt);
  return { hour: Number(t.slice(0, 2)), minute: Number(t.slice(3, 5)) };
}

/** The Monday of the week `key` falls in. Baselines are recomputed once a week, on Mondays. */
export function weekStart(key: DateKey): DateKey {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(y, m - 1, d, 12).getDay(); // 0 = Sunday
  return addDays(key, -((day + 6) % 7));
}

/**
 * A date typed on a number pad, which has no hyphen on an iPhone: only the digits count, and the
 * hyphens are put in while typing. "20250303" and "2025-03-03" both become "2025-03-03".
 */
export function formatDateInput(text: string): string {
  const d = text.replace(/\D/g, '').slice(0, 8);
  if (d.length > 6) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  if (d.length > 4) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}

/** A real calendar date "YYYY-MM-DD": not 30 February, not month 13. */
export function isDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
