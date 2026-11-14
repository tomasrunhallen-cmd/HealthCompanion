// Simulated watch data for Dygnsrytm: invented nights and evenings with known events, used by
// the tests and by the simulated part of the report. Never the person's data, and always marked
// as simulated where it is shown. Seeded, so every run gives the same days.

import type { DateKey, MeasuredDay } from '../domain/types';
import { addDays } from './dates';
import type { ActivityDay, EpisodeSource, EpisodeStart, EpisodeType, RhythmData } from './rhythm';

/** A small seeded random generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-9), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clock = (m: number) => {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

export type SimEvent =
  /** Nights before an episode start drift later and shorter, with activity later in the evening (up). */
  | { kind: 'episode'; start: DateKey; type: EpisodeType; source?: EpisodeSource; days?: number; leadNights?: number; withActivity?: boolean }
  /** Late nights and late evenings without any episode: a festival week, guests, a deadline. */
  | { kind: 'late_week'; from: DateKey; nights: number }
  | { kind: 'short_night'; date: DateKey; hours: number }
  | { kind: 'not_worn'; from: DateKey; days: number }
  | { kind: 'timezone'; from: DateKey; offsetMin: number };

export interface SimOptions {
  end: DateKey;
  days: number;
  seed?: number;
  /** Usual falling asleep in minutes after midnight-relative 18:00 axis: 23:15 is 315. */
  usualOnset?: number;
  usualHours?: number;
  events?: SimEvent[];
  /** No heart rate at all: the activity source is missing. */
  noActivity?: boolean;
}

/** Days of invented watch data with the events given, plus the episode starts as documented. */
export function simulate(opts: SimOptions): RhythmData {
  const rand = seeded(opts.seed ?? 7);
  const measured: Record<DateKey, MeasuredDay> = {};
  const activity: Record<DateKey, ActivityDay> = {};
  const episodes: EpisodeStart[] = [];
  const onset0 = opts.usualOnset ?? 315;
  const hours0 = opts.usualHours ?? 7.3;
  const ev = opts.events ?? [];
  const start = addDays(opts.end, -(opts.days - 1));
  for (const e of ev) {
    if (e.kind === 'episode') episodes.push({ id: `sim_${e.start}`, start: e.start, end: addDays(e.start, (e.days ?? 21) - 1), type: e.type, source: e.source ?? 'self_retro', createdAt: `${e.start}T12:00:00.000Z` });
  }
  const within = (d: DateKey, a: DateKey, n: number) => d >= a && d <= addDays(a, n - 1);
  let tz = 60;
  for (let d = start; d <= opts.end; d = addDays(d, 1)) {
    let onset = onset0 + gauss(rand) * 18;
    let hours = hours0 + gauss(rand) * 0.35;
    let late = 0;
    for (const e of ev) {
      if (e.kind === 'timezone' && d >= e.from) tz = e.offsetMin;
      if (e.kind === 'episode') {
        const lead = e.leadNights ?? 5;
        const k = Math.round((Date.parse(e.start) - Date.parse(d)) / 86_400_000);
        if (k >= 0 && k < lead) {
          // k nights before the start: the closer, the stronger.
          const s = (lead - k) / lead;
          if (e.type === 'up') { onset += 150 * s; hours -= 2.4 * s; late += e.withActivity === false ? 0 : 1; }
          if (e.type === 'down') { hours += 2.2 * s; onset -= 20 * s; }
          if (e.type === 'mixed') { onset += (k % 2 ? 140 : -60) * s; }
        }
        if (within(d, e.start, e.days ?? 21)) {
          if (e.type === 'up') { onset += 150; hours -= 2.5; late += 1; }
          if (e.type === 'down') { hours += 2.4; }
        }
      }
      if (e.kind === 'late_week' && within(d, e.from, e.nights)) { onset += 140; hours -= 1.6; late += 1; }
      if (e.kind === 'short_night' && d === e.date) hours = e.hours;
    }
    const worn = !ev.some((e) => e.kind === 'not_worn' && within(d, e.from, e.days));
    if (!worn) continue;
    const wake = onset + hours * 60;
    const startClock = clock(18 * 60 + onset);
    measured[d] = {
      date: d, source: 'garmin', sleepHours: Math.round(hours * 10) / 10, deepMinutes: null, remMinutes: null,
      sleepStart: startClock, sleepEnd: clock(18 * 60 + wake), stressAvg: 25, stressHighMinutes: 0, bodyBatteryWake: 60,
      tzOffsetMin: tz, fetchedAt: `${d}T09:00:00.000Z`,
    };
    if (opts.noActivity) continue;
    // The evening before night d+1 lives on day d (hours 4–23) and the small hours of d+1.
    const activeMinutes: (number | null)[] = Array(24).fill(0).map((_, h) => {
      const base = h >= 8 && h <= 19 ? 9 : h >= 20 && h <= 22 ? 3 : h === 23 ? 1 : 0;
      const nextLate = ev.some((e) =>
        (e.kind === 'late_week' && within(addDays(d, 1), e.from, e.nights))
        || (e.kind === 'episode' && e.type === 'up' && e.withActivity !== false && (() => { const k = Math.round((Date.parse(e.start) - Date.parse(addDays(d, 1))) / 86_400_000); return (k >= 0 && k < (e.leadNights ?? 5)) || within(addDays(d, 1), e.start, e.days ?? 21); })()));
      const lateBoost = nextLate && h >= 21 ? 12 : 0;
      const smallHoursBoost = late && h <= 2 ? 10 : 0;
      return Math.max(0, Math.round(base + lateBoost + smallHoursBoost + gauss(rand) * 1.5));
    });
    activity[d] = { date: d, activeMinutes, worn: Array(24).fill(1), restingHr: 58, tzOffsetMin: tz, lastReading: '23:58', fetchedAt: `${addDays(d, 1)}T09:00:00.000Z` };
  }
  return { measured, activity, episodes };
}

/** The year of invented data behind the simulated part of the report. */
export function simulatedYear(end: DateKey = '2026-11-13'): { data: RhythmData; description: string[] } {
  const e = (n: number) => addDays(end, -n);
  const events: SimEvent[] = [
    { kind: 'episode', start: e(300), type: 'up', source: 'clinical' },
    { kind: 'late_week', from: e(250), nights: 4 },
    { kind: 'episode', start: e(220), type: 'down', source: 'self_retro' },
    { kind: 'not_worn', from: e(170), days: 9 },
    { kind: 'episode', start: e(140), type: 'up', source: 'self_retro', withActivity: false },
    { kind: 'timezone', from: e(110), offsetMin: 120 },
    { kind: 'timezone', from: e(104), offsetMin: 60 },
    { kind: 'short_night', date: e(90), hours: 3.9 },
    { kind: 'late_week', from: e(75), nights: 3 },
    { kind: 'episode', start: e(45), type: 'up', source: 'self_retro' },
    { kind: 'episode', start: e(15), type: 'down', source: 'clinical', leadNights: 3 },
  ];
  return {
    data: simulate({ end, days: 365, seed: 11, events }),
    description: [
      'Ett år av påhittade nätter: insomning kring 23:15 och 7,3 timmars sömn, med slumpmässig variation.',
      'Tre uppvarvade episoder, där sömnen förskjuts och kortas fem nätter före starten. I en av dem syns ingen kvällsaktivitet.',
      'Två nedstämda episoder, där sömnen blir längre före starten. Den sista har bara tre nätters förlopp.',
      'Två stabila veckor med sena kvällar och nätter utan någon episod, en enstaka kort natt, nio dygn utan klocka och en resa med tidszonsbyte.',
    ],
  };
}
