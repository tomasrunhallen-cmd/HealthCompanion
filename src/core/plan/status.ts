// Läget i dag: a few sentences on Hem about how things are going, made once a day. The code
// decides everything that matters: the facts (routines begun or kept, the days after a larger
// event, the week's levels, mood and sleep), which of them are worth lifting, and the tone. A
// language model may word them; its text is checked, and on any doubt the code's own words stand.
//
// The tone follows the state, never the other way round: encouragement only on a calm week. On a
// yellow or red day, or while the person follows the plan's routines for winding up, the text is
// calm and asks for nothing more. In a week when the emergency rule showed Hjälp nu, there is no
// summary at all.

import { addDays, formatDateSv } from '../analysis/dates';
import { replyProblem } from '../chat/chat';
import type { DateKey, Level } from '../domain/types';

export interface StatusDay {
  date: DateKey;
  level: Level | null;
  mood: number | null;
  sleepHours: number | null;
  /** The emergency rule matched the day's note (fully). */
  akut: boolean;
}

export interface StatusInput {
  today: DateKey;
  /** The days with a check-in or a measured night, any order. */
  days: StatusDay[];
  /** The routines counted, as Hem and Trend count them. */
  routines: { id: string; text: string }[];
  /** Ticked routines. */
  ticks: { date: DateKey; routineId: string }[];
  /** Evenings with any routine answer. */
  answeredDates: DateKey[];
  /** The person's own events with a date (kontextbanken, Dagligt). */
  events: { date: DateKey; text: string }[];
  /** The person follows the plan's routines for winding up. */
  upward: boolean;
}

/** pepp: a calm week with something worth lifting. calm: plain and supportive, nothing more asked. plan: no summary, the plan. */
export type StatusTone = 'pepp' | 'calm' | 'plan';

export interface StatusFacts {
  tone: StatusTone;
  /** What is worth lifting, the most worth first, already in words. */
  highlights: string[];
  /** Everything the model gets, highlights first. The only source of numbers it may use. */
  lines: string[];
}

const LEVEL_PLURAL: Record<Level, [string, string]> = { green: ['grön', 'gröna'], yellow: ['gul', 'gula'], red: ['röd', 'röda'] };
const dec = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
const within = (d: DateKey, from: DateKey, to: DateKey) => d >= from && d <= to;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export const STATUS_PARAMS = {
  /** A routine has begun to go better: at least this many evenings this week, and this many more than the week before. */
  betterMin: 3,
  betterGain: 2,
  /** A routine is kept: at least this share of the evenings with answers, two weeks running, with at least this many evenings each. */
  keptShare: 0.85,
  keptEvenings: 4,
  /** The days after an event are looked at from this many days after it, up to a week. */
  eventMinDays: 2,
  eventMaxDays: 7,
  maxHighlights: 3,
} as const;
const P = STATUS_PARAMS;

export function statusFacts(input: StatusInput): StatusFacts {
  const { today } = input;
  const weekFrom = addDays(today, -6);
  const prevFrom = addDays(today, -13), prevTo = addDays(today, -7);
  const week = input.days.filter((d) => within(d.date, weekFrom, today));

  // Tone first: it decides whether anything is lifted at all.
  const recentLevels = input.days.filter((d) => d.level && within(d.date, addDays(today, -2), today)).sort((a, b) => b.date.localeCompare(a.date));
  const latest = recentLevels[0]?.level ?? null;
  const tone: StatusTone = week.some((d) => d.akut)
    ? 'plan'
    : latest === 'yellow' || latest === 'red' || recentLevels.some((d) => d.level === 'red') || input.upward
      ? 'calm'
      : 'pepp';

  // Routines: begun to go better, or kept two weeks running.
  const evWeek = new Set(input.answeredDates.filter((d) => within(d, weekFrom, today))).size;
  const evPrev = new Set(input.answeredDates.filter((d) => within(d, prevFrom, prevTo))).size;
  const ticked = (id: string, from: DateKey, to: DateKey) => new Set(input.ticks.filter((t) => t.routineId === id && within(t.date, from, to)).map((t) => t.date)).size;
  const better: string[] = [];
  const kept: string[] = [];
  for (const r of input.routines) {
    const now = ticked(r.id, weekFrom, today), before = ticked(r.id, prevFrom, prevTo);
    if (now >= P.betterMin && now >= before + P.betterGain) {
      better.push(`”${r.text}”: ${now} av ${evWeek} kvällar den senaste veckan, mot ${before} av ${evPrev} veckan innan.`);
    } else if (evWeek >= P.keptEvenings && evPrev >= P.keptEvenings && now / evWeek >= P.keptShare && before / evPrev >= P.keptShare) {
      kept.push(`”${r.text}”: ${now} av ${evWeek} kvällar den senaste veckan och ${before} av ${evPrev} veckan innan.`);
    }
  }

  // The days after a larger event: all checked-in days since green, none stopped by the emergency rule.
  const after: string[] = [];
  for (const e of [...input.events].sort((a, b) => b.date.localeCompare(a.date))) {
    if (!within(e.date, addDays(today, -P.eventMaxDays), addDays(today, -P.eventMinDays))) continue;
    const since = input.days.filter((d) => d.date > e.date && d.date <= today);
    const levels = since.filter((d) => d.level);
    if (levels.length < 2 || since.some((d) => d.akut) || levels.some((d) => d.level !== 'green')) continue;
    const sleeps = since.map((d) => d.sleepHours).filter((h): h is number => h != null);
    after.push(`Efter ”${e.text}” ${formatDateSv(e.date)}: ${levels.length} avstämningar sedan dess, alla gröna${sleeps.length >= 2 ? `, sömn i snitt ${dec(mean(sleeps))} h` : ''}.`);
  }
  const highlights = tone === 'pepp' ? [...better, ...after, ...kept].slice(0, P.maxHighlights) : [];

  // The week in plain numbers, for any tone.
  const lines = [...highlights];
  const counts = { green: 0, yellow: 0, red: 0 } as Record<Level, number>;
  for (const d of week) if (d.level) counts[d.level]++;
  const none = 7 - week.filter((d) => d.level).length;
  const levelWords = (['green', 'yellow', 'red'] as Level[]).filter((l) => counts[l]).map((l) => `${counts[l]} ${LEVEL_PLURAL[l][counts[l] === 1 ? 0 : 1]}`);
  lines.push(`Senaste 7 dagarna: ${[...levelWords, ...(none ? [`${none} utan avstämning`] : [])].join(', ') || 'inga avstämningar'}.`);
  const moods = week.map((d) => d.mood).filter((m): m is number => m != null);
  if (moods.length) {
    const lo = Math.min(...moods), hi = Math.max(...moods);
    lines.push(`Stämning ${lo === hi ? signed(lo) : `${signed(lo)} till ${signed(hi)}`} på skalan −3 till +3.`);
  }
  const sleepWeek = week.map((d) => d.sleepHours).filter((h): h is number => h != null);
  const sleepBefore = input.days.filter((d) => within(d.date, addDays(today, -27), prevTo)).map((d) => d.sleepHours).filter((h): h is number => h != null);
  if (sleepWeek.length >= 3) lines.push(`Sömn i snitt ${dec(mean(sleepWeek))} h senaste veckan${sleepBefore.length >= 7 ? `, ${dec(mean(sleepBefore))} h de tre veckorna innan` : ''}.`);
  if (evWeek) {
    const done = input.routines.reduce((n, r) => n + ticked(r.id, weekFrom, today), 0);
    lines.push(`Rutiner: ${done} avbockade av ${evWeek * input.routines.length} möjliga senaste veckan.`);
  }
  // Something today the person might like to hear about, also when it is not lifted.
  if (tone !== 'pepp' && (better.length || kept.length)) lines.push(...[...better, ...kept].slice(0, 1));
  return { tone, highlights, lines };
}

/** What the card says when no model words it: the code's own, plain words. */
export function codeStatusText(f: StatusFacts): string {
  if (f.tone === 'plan') return 'Den här veckan visade appen Hjälp nu. Kortet sammanfattar inget just nu. Din plan och Hjälp nu finns alltid kvar.';
  if (f.highlights.length) return f.highlights.slice(0, 2).join(' ');
  return f.lines[0] ?? 'Inget att sammanfatta än.';
}

// ---- the model's words, checked ----

export const STATUS_MAX = 320;
const NUMBER_WORDS: Record<string, number> = { två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, elva: 11, tolv: 12, fjorton: 14 };
// No diagnosis, cause, forecast or warning, no demands, and no level of its own.
const FORBIDDEN = /\b(?:episod|mani|hypomani|depress|deprimera|skov|diagnos|bipolär|orsak|beror på|leder till|förutsäg|förutse|varna|varning|risk|sjukdom|frisk)|\b(?:bör|måste|borde|ska du)(?![a-zåäö])/i;
const CHEER = /!|fantastisk|grym|superb|otrolig|imponerande|bästa/i;

/**
 * The model's text when it may be shown, else null. Every number in it must stand in the facts,
 * it must keep to a few short sentences, and on a calm or plan day it may not cheer.
 */
export function checkStatus(answer: unknown, f: StatusFacts): string | null {
  const raw = (answer as { text?: unknown } | null)?.text;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text || text.length > STATUS_MAX || FORBIDDEN.test(text) || replyProblem(text)) return null;
  if ((text.match(/[.!?](\s|$)/g) ?? []).length > 3) return null;
  if (f.tone !== 'pepp' && CHEER.test(text)) return null;
  const facts = f.lines.join('\n');
  const allowed = new Set((facts.match(/\d+/g) ?? []).map(Number));
  for (const d of text.match(/\d+/g) ?? []) if (!allowed.has(Number(d))) return null;
  for (const w of text.toLowerCase().match(/[a-zåäö]+/g) ?? []) if (w in NUMBER_WORDS && !allowed.has(NUMBER_WORDS[w])) return null;
  return text;
}

/** The instruction for the tone, as the prompt gets it. */
export const TONE_TEXT: Record<Exclude<StatusTone, 'plan'>, string> = {
  pepp: 'Peppande och varm: lyft det som gått bra, med siffrorna, utan att överdriva. Inga utropstecken.',
  calm: 'Lugn och stöttande: säg sakligt hur veckan sett ut. Ingen pepp, inga nya mål och inget om att göra mer.',
};
