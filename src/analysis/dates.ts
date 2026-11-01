import type { DateKey } from '../domain/types';

/** Entries made before this hour count to the previous evening. */
export const DAY_ROLLOVER_HOUR = 5;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The evening an entry made at `d` belongs to. */
export function eveningDateKey(d: Date): DateKey {
  if (d.getHours() < DAY_ROLLOVER_HOUR) {
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

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The Monday of the week `key` falls in. Baselines are recomputed once a week, on Mondays. */
export function weekStart(key: DateKey): DateKey {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(y, m - 1, d, 12).getDay(); // 0 = Sunday
  return addDays(key, -((day + 6) % 7));
}
