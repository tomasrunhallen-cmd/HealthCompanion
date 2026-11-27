// Senaste veckan, at the top of Hem: what the person has done with their own routines, in the
// app's own sentences, each one a fixed fact (granskning 26 november). No language model and no
// notes: the same observation always reads the same way, and a sentence never concludes how the
// person feels ("du verkar må bra"). Computed from what is saved each time Hem is drawn, so a red
// check-in or a stopped note changes it at once, also without a network.
//
// The rules:
//   - Every routine against its own goal: every day, N times a week, or its weekdays.
//   - An evening without a check-in is unknown: never done, never missed.
//   - "Kommit igång" only with more confirmed times than the week before, and enough evenings to judge.
//   - "Nådde ditt mål båda veckorna" only when the ticks confirm the whole goal both weeks.
//   - After an event: the number of check-ins since, all green; the person reads what it means.
//   - Nothing concrete to say: the card is silent.
// On a yellow or red day, or while following the plan's routines for winding up, it says only
// what was done, never that something has come going; in a week when Hjälp nu was shown it says
// nothing but where help is.

import { addDays, formatDateSv, weekStart } from '../analysis/dates';
import type { DateKey, Level, RoutineFrequency } from '../domain/types';
import { frequencyText, weekGoal } from './routineFrequency';

export interface StatusDay {
  date: DateKey;
  level: Level | null;
  /** The emergency rule matched the day's note (fully). */
  akut: boolean;
}

export interface StatusInput {
  today: DateKey;
  /** The days with a check-in, any order. */
  days: StatusDay[];
  /** The routines counted, as Hem and Trend count them, each with its goal. */
  routines: { id: string; text: string; frequency: RoutineFrequency }[];
  /** Ticked routines. */
  ticks: { date: DateKey; routineId: string }[];
  /** Evenings with any routine answer. */
  answeredDates: DateKey[];
  /** The person's own events with a date (kontextbanken, Dagligt). */
  events: { date: DateKey; text: string }[];
  /** The person follows the plan's routines for winding up. */
  upward: boolean;
}

/** open: a calm week. quiet: a yellow or red day, or winding up: only what was done. plan: Hjälp nu was shown. */
export type StatusTone = 'open' | 'quiet' | 'plan';

export interface StatusLine {
  kind: 'started' | 'kept' | 'reached' | 'did' | 'after_event';
  text: string;
}

export interface StatusFacts {
  tone: StatusTone;
  /** At most three, the most worth first. Empty: nothing concrete, the card is silent. */
  lines: StatusLine[];
  /** What it rests on, for "Vad bygger det på?". */
  basis: string[];
}

export const STATUS_PARAMS = {
  /** "Kommit igång": at least this share of the goal the latest 7 days, this much more than the 7 before, and this many more confirmed times. */
  startedShare: 0.6,
  startedGain: 0.3,
  startedMoreTimes: 2,
  /** A daily routine needs this many evenings with answers in each span for "kommit igång". */
  minEvenings: 4,
  /** "Du gjorde": at least this many times in the latest 7 days. */
  didMin: 2,
  /** After an event: from this many days after it, up to a week, with at least this many check-ins since. */
  eventMinDays: 2,
  eventMaxDays: 7,
  eventMinCheckins: 2,
  maxLines: 3,
} as const;
const P = STATUS_PARAMS;

const WORD = ['noll', 'en', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv', 'tretton', 'fjorton'];
const num = (n: number) => WORD[n] ?? String(n);
const within = (d: DateKey, from: DateKey, to: DateKey) => d >= from && d <= to;
const short = (d: DateKey) => formatDateSv(d).replace(/^[a-zåäö]+ /, '');

export function statusFacts(input: StatusInput): StatusFacts {
  const { today } = input;
  const weekFrom = addDays(today, -6);

  // The tone, from the days themselves: a stopped note or a yellow or red day wins at once.
  const recent = input.days.filter((d) => d.level && within(d.date, addDays(today, -2), today)).sort((a, b) => b.date.localeCompare(a.date));
  const latest = recent[0]?.level ?? null;
  const tone: StatusTone = input.days.some((d) => d.akut && within(d.date, weekFrom, today))
    ? 'plan'
    : latest === 'yellow' || latest === 'red' || recent.some((d) => d.level === 'red') || input.upward
      ? 'quiet'
      : 'open';

  // Calendar weeks, Monday to Sunday (28 November): this week so far, last week, the week before.
  const monday = weekStart(today);
  const lastFrom = addDays(monday, -7), lastTo = addDays(monday, -1);
  const beforeFrom = addDays(monday, -14), beforeTo = addDays(monday, -8);
  const answered = new Set(input.answeredDates);
  const evenings = (from: DateKey, to: DateKey) => { const out: DateKey[] = []; for (let d = from; d <= to; d = addDays(d, 1)) if (answered.has(d)) out.push(d); return out; };
  const evNow = evenings(monday, today), evLast = evenings(lastFrom, lastTo), evBefore = evenings(beforeFrom, beforeTo);
  const basis = [
    'Veckor räknas måndag till söndag, och varje rutin mot sitt eget mål.',
    `Kvällar med avbockning: ${num(evNow.length)} den här veckan hittills, ${num(evLast.length)} förra veckan (${short(lastFrom)}–${short(lastTo)}), ${num(evBefore.length)} veckan innan.`,
    'En kväll utan avstämning räknas varken som gjord eller som missad.',
  ];
  if (tone === 'plan') return { tone, lines: [], basis };

  const ticked = (id: string, from: DateKey, to: DateKey) => new Set(input.ticks.filter((t) => t.routineId === id && within(t.date, from, to)).map((t) => t.date)).size;
  /** The whole goal of a full week, whatever was answered. */
  const fullGoal = (f: RoutineFrequency) => (f.kind === 'daily' ? 7 : f.kind === 'weekly' ? f.times : f.days.length);
  const times = (f: RoutineFrequency, n: number) => (f.kind === 'daily' ? `${num(n)} ${n === 1 ? 'kväll' : 'kvällar'}` : `${num(n)} ${n === 1 ? 'gång' : 'gånger'}`);

  const started: StatusLine[] = [], kept: StatusLine[] = [], reached: StatusLine[] = [], did: (StatusLine & { n: number })[] = [];
  for (const r of input.routines) {
    const now = ticked(r.id, monday, today), last = ticked(r.id, lastFrom, lastTo), before = ticked(r.id, beforeFrom, beforeTo);
    const goal = fullGoal(r.frequency);
    // Kept: the ticks confirm the whole goal both of the latest full weeks.
    if (goal && last >= goal && before >= goal) {
      kept.push({ kind: 'kept', text: `Du nådde ditt mål för ”${r.text}”, ${frequencyText(r.frequency)}, både förra veckan och veckan innan.` });
      continue;
    }
    // A weekly or weekday goal already reached this week.
    if (r.frequency.kind !== 'daily' && goal && now >= goal) {
      reached.push({ kind: 'reached', text: `Du har redan nått veckans mål för ”${r.text}”, ${frequencyText(r.frequency)}.` });
      continue;
    }
    const gLast = weekGoal(r.frequency, evLast, last).goal, gBefore = weekGoal(r.frequency, evBefore, before).goal;
    const enough = r.frequency.kind !== 'daily' || (evLast.length >= P.minEvenings && evBefore.length >= P.minEvenings);
    const share = gLast ? Math.min(last / gLast, 1) : 0, shareBefore = gBefore ? Math.min(before / gBefore, 1) : 0;
    if (tone === 'open' && enough && gLast && gBefore && last >= before + P.startedMoreTimes && share >= P.startedShare && share >= shareBefore + P.startedGain) {
      started.push({ kind: 'started', text: `”${r.text}” kom igång förra veckan: ${times(r.frequency, last)}, mot ${times(r.frequency, before)} veckan innan.` });
    } else if (now >= P.didMin) {
      did.push({ kind: 'did', n: now, text: `Du har gjort ”${r.text}” ${times(r.frequency, now)} den här veckan.` });
    }
  }

  // After an event: only the check-ins there are, all green; what it means is the person's to say.
  const after: StatusLine[] = [];
  if (tone === 'open') {
    for (const e of [...input.events].sort((a, b) => b.date.localeCompare(a.date))) {
      if (!within(e.date, addDays(today, -P.eventMaxDays), addDays(today, -P.eventMinDays))) continue;
      const since = input.days.filter((d) => d.date > e.date && d.date <= today && d.level);
      if (since.length < P.eventMinCheckins || since.some((d) => d.level !== 'green' || d.akut)) continue;
      after.push({ kind: 'after_event', text: `Dina ${num(since.length)} avstämningar sedan ”${e.text}” ${short(e.date)} har varit gröna.` });
      break;
    }
  }

  const lines = [...started, ...kept, ...reached, ...after, ...did.sort((a, b) => b.n - a.n).map(({ kind, text }) => ({ kind, text }))].slice(0, P.maxLines);
  return { tone, lines, basis };
}
