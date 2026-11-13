// The day's routine suggestion on Hem: the code picks the candidates and their numbers
// (routineFrequency.ts); a language model, when one is set up, chooses one to three of them
// and words why (prompts/dagsforslag.md). Its answer is checked here: only listed routines,
// at most three, short reasons. Without a model, or with an answer that does not hold, the
// code's own order is used. Only the routines' words, scrubbed, and their numbers are sent.

import { addDays } from '../analysis/dates';
import type { DateKey, Level } from '../domain/types';
import { scrub } from '../privacy/scrub';
import { frequencyText, rankDue, type RoutineStatus } from './routineFrequency';

export const MAX_CANDIDATES = 8;
export const MAX_SUGGESTIONS = 3;
const WEEKDAYS = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
const LEVEL_WORD: Record<Level, string> = { green: 'grönt', yellow: 'gult', red: 'rött' };

export interface DaySuggestionItem {
  routineId: string;
  why: string;
}

export interface DaySuggestion {
  date: DateKey;
  items: DaySuggestionItem[];
  method: 'llm' | 'code';
  model: string | null;
  promptVersion: string | null;
  createdAt: string;
}

export interface DayContext {
  today: DateKey;
  /** 1 Monday … 7 Sunday. */
  weekday: number;
  yesterdayLevel: Level | null;
  sleepHours: number | null;
  sleepLimit: number;
}

const dec = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

function lastDoneText(s: RoutineStatus, today: DateKey): string {
  if (!s.lastDone) return 'inte gjord än';
  if (s.lastDone === addDays(today, -1)) return 'i går';
  if (s.lastDone === addDays(today, -2)) return 'i förrgår';
  const days = Math.round((Date.parse(today) - Date.parse(s.lastDone)) / 864e5);
  return `för ${days} dagar sedan`;
}

/** The week's numbers for one routine, in words: shared by the model's input and the code's reason. */
export function weekText(s: RoutineStatus): string {
  if (s.frequency.kind === 'daily') {
    const past = 7 - s.daysLeft;
    return past ? `${s.doneThisWeek} av ${past} ${past === 1 ? 'dag' : 'dagar'} hittills den här veckan` : 'varje dag, veckan börjar i dag';
  }
  if (s.frequency.kind === 'weekdays') return `planerad i dag (${frequencyText(s.frequency)})`;
  return `${s.doneThisWeek} av ${s.goalThisWeek} den här veckan, ${s.daysLeft === 1 ? 'sista dagen' : `${s.daysLeft} dagar kvar`}`;
}

export interface SuggestionInput {
  variables: Record<string, string>;
  /** R1 → routine id. */
  ids: Map<string, string>;
  candidates: RoutineStatus[];
}

export function suggestionInput(statuses: RoutineStatus[], ctx: DayContext, names: string[]): SuggestionInput {
  const candidates = rankDue(statuses, MAX_CANDIDATES);
  const ids = new Map<string, string>();
  const lines = candidates.map((s, i) => {
    const id = `R${i + 1}`;
    ids.set(id, s.routine.id);
    return [
      `${id}: ${scrub(s.routine.text, names).text}`,
      `hur ofta: ${frequencyText(s.frequency)}`,
      weekText(s),
      `senast: ${lastDoneText(s, ctx.today)}`,
      s.rate4w != null ? `senaste fyra veckorna: ${Math.round(s.rate4w * 100)}\u00a0%` : 'senaste fyra veckorna: inga svar',
    ].join(' | ');
  });
  const day = [
    `Veckodag: ${WEEKDAYS[ctx.weekday - 1]}.`,
    ctx.yesterdayLevel ? `Gårdagens nivå: ${LEVEL_WORD[ctx.yesterdayLevel]}.` : 'Gårdagens nivå: ingen avstämning.',
    ctx.sleepHours != null ? `Sömn i natt: ${dec(ctx.sleepHours)} h (personens gräns ${dec(ctx.sleepLimit)} h).` : 'Sömn i natt: okänd.',
  ].join('\n');
  return { variables: { dagslage: day, kandidater: lines.join('\n') }, ids, candidates };
}

interface Answer {
  suggestions?: { routine?: unknown; why?: unknown }[];
}

/** The model's answer, checked: listed routines only, once each, at most three, a short reason. Null when nothing holds. */
export function checkSuggestion(answer: unknown, input: SuggestionInput): DaySuggestionItem[] | null {
  const list = (answer as Answer | null)?.suggestions;
  if (!Array.isArray(list)) return null;
  const out: DaySuggestionItem[] = [];
  for (const s of list) {
    const routineId = typeof s?.routine === 'string' ? input.ids.get(s.routine.trim()) : undefined;
    const why = typeof s?.why === 'string' ? s.why.trim().replace(/\s+/g, ' ') : '';
    if (!routineId || out.some((o) => o.routineId === routineId) || !why || why.length > 160) continue;
    out.push({ routineId, why });
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out.length ? out : null;
}

/**
 * A routine that needs attention today: a weekly goal not yet reached, a planned weekday, or a
 * daily routine kept less than 85 % of the time lately or not done yesterday.
 */
function behind(s: RoutineStatus, today: DateKey): boolean {
  if (s.frequency.kind !== 'daily') return true;
  return s.rate4w == null || s.rate4w < 0.85 || s.lastDone !== addDays(today, -1);
}

/**
 * The code's own suggestion: the routines due today that need attention, most pressing first,
 * at most three, with their numbers as the reason. When all are going well, only the most
 * pressing one, so the suggestion means something.
 */
export function codeSuggestion(statuses: RoutineStatus[], today: DateKey): DaySuggestionItem[] {
  const due = rankDue(statuses, MAX_CANDIDATES);
  const picked = due.filter((s) => behind(s, today)).slice(0, MAX_SUGGESTIONS);
  return (picked.length ? picked : due.slice(0, 1)).map((s) => {
    const week = weekText(s);
    const why = s.rate4w != null && s.frequency.kind !== 'weekly'
      ? `${week.charAt(0).toUpperCase()}${week.slice(1)}, ${Math.round(s.rate4w * 100)}\u00a0% de senaste fyra veckorna.`
      : `${week.charAt(0).toUpperCase()}${week.slice(1)}.`;
    return { routineId: s.routine.id, why };
  });
}
