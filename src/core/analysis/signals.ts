// Kontroll över signaler: when the app may speak up by itself. Quiet hours hold back the app's
// own notices (the sleep notice); reminders the person set themselves still come. Proposals
// show directly, once a week (Mondays), or only under Inför återbesök.

import type { AppSettings, DateKey } from '../domain/types';

const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** True inside the quiet hours, which may run over midnight (22:00–07:00). */
export function inQuietHours(quiet: AppSettings['quietHours'], now: Date): boolean {
  if (!quiet) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const s = min(quiet.start);
  const e = min(quiet.end);
  return s === e ? false : s < e ? t >= s && t < e : t >= s || t < e;
}

/** Whether proposals and the profile review may show on the home screen today. */
export function suggestionsOnHome(pace: AppSettings['suggestionPace'], today: DateKey): boolean {
  if (!pace || pace === 'direct') return true;
  if (pace === 'visit') return false;
  const [y, m, d] = today.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getDay() === 1;
}

export const PACE_TEXT: Record<NonNullable<AppSettings['suggestionPace']>, string> = {
  direct: 'Direkt',
  weekly: 'En gång i veckan',
  visit: 'Bara inför återbesök',
};
