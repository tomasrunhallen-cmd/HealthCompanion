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

import { addDays, formatDateSv } from '../analysis/dates';
import type { DateKey, Level, RoutineFrequency } from '../domain/types';
import { frequencyText, weekday } from './routineFrequency';

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
  kind: 'started' | 'kept' | 'did' | 'after_event';
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
  const prevFrom = addDays(today, -13), prevTo = addDays(today, -7);

  // The tone, from the days themselves: a stopped note or a yellow or red day wins at once.
  const recent = input.days.filter((d) => d.level && within(d.date, addDays(today, -2), today)).sort((a, b) => b.date.localeCompare(a.date));
  const latest = recent[0]?.level ?? null;
  const tone: StatusTone = input.days.some((d) => d.akut && within(d.date, weekFrom, today))
    ? 'plan'
    : latest === 'yellow' || latest === 'red' || recent.some((d) => d.level === 'red') || input.upward
      ? 'quiet'
      : 'open';

  const answered = new Set(input.answeredDates);
  const evenings = (from: DateKey, to: DateKey) => { const out: DateKey[] = []; for (let d = from; d <= to; d = addDays(d, 1)) if (answered.has(d)) out.push(d); return out; };
  const evWeek = evenings(weekFrom, today), evPrev = evenings(prevFrom, prevTo);
  const basis = [
    `Räknat på kvällar med avbockning: ${num(evWeek.length)} ${evWeek.length === 1 ? 'kväll' : 'kvällar'} ${short(weekFrom)}–${short(today)}, ${num(evPrev.length)} ${short(prevFrom)}–${short(prevTo)}.`,
    'En kväll utan avstämning räknas varken som gjord eller som missad.',
  ];
  if (tone === 'plan') return { tone, lines: [], basis };

  const ticked = (id: string, from: DateKey, to: DateKey) => new Set(input.ticks.filter((t) => t.routineId === id && within(t.date, from, to)).map((t) => t.date)).size;
  /** The whole goal in a 7-day span, whatever was answered. */
  const fullGoal = (f: RoutineFrequency) => (f.kind === 'daily' ? 7 : f.kind === 'weekly' ? f.times : f.days.length);
  /** What could be judged: a daily routine's evenings with answers, a weekday routine's planned days with answers, a weekly goal's number. */
  const judgeable = (f: RoutineFrequency, ev: DateKey[]) => (f.kind === 'weekly' ? (ev.length ? f.times : 0) : f.kind === 'weekdays' ? ev.filter((d) => f.days.includes(weekday(d))).length : ev.length);
  const times = (f: RoutineFrequency, n: number) => (f.kind === 'daily' ? `${num(n)} ${n === 1 ? 'kväll' : 'kvällar'}` : `${num(n)} ${n === 1 ? 'gång' : 'gånger'}`);

  const started: StatusLine[] = [], kept: StatusLine[] = [], did: (StatusLine & { n: number })[] = [];
  for (const r of input.routines) {
    const now = ticked(r.id, weekFrom, today), before = ticked(r.id, prevFrom, prevTo);
    const goal = fullGoal(r.frequency);
    // Kept: the ticks confirm the whole goal in both weeks.
    if (goal && now >= goal && before >= goal) {
      kept.push({ kind: 'kept', text: `Du nådde ditt mål för ”${r.text}”, ${frequencyText(r.frequency)}, båda veckorna.` });
      continue;
    }
    const jNow = judgeable(r.frequency, evWeek), jBefore = judgeable(r.frequency, evPrev);
    const enough = r.frequency.kind !== 'daily' || (evWeek.length >= P.minEvenings && evPrev.length >= P.minEvenings);
    const share = jNow ? Math.min(now / jNow, 1) : 0, shareBefore = jBefore ? Math.min(before / jBefore, 1) : 0;
    if (tone === 'open' && enough && jNow && jBefore && now >= before + P.startedMoreTimes && share >= P.startedShare && share >= shareBefore + P.startedGain) {
      started.push({ kind: 'started', text: `”${r.text}” har kommit igång: ${times(r.frequency, now)} den senaste veckan, mot ${times(r.frequency, before)} veckan innan.` });
    } else if (now >= P.didMin) {
      did.push({ kind: 'did', n: now, text: `Du gjorde ”${r.text}” ${times(r.frequency, now)} den senaste veckan.` });
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

  const lines = [...started, ...kept, ...after, ...did.sort((a, b) => b.n - a.n).map(({ kind, text }) => ({ kind, text }))].slice(0, P.maxLines);
  return { tone, lines, basis };
}
