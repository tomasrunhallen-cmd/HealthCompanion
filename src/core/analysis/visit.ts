// Inför återbesök: the last 14 or 30 days for the person to bring to the care. Level per day,
// sleep and stress, the signs that matched by direction, the routines kept, and the person's
// own list of things to bring up. No notes are included; the person decides what to share.

import type { Assessment, ContextEntry, DateKey, Entry, Level, MeasuredDay, PlanItem, Polarity } from '../domain/types';
import { addDays } from './dates';
import { routines } from '../plan/routines';
import { redStepsBetween } from './afterRed';

export interface VisitDay {
  date: DateKey;
  level: Level | null;
  sleepHours: number | null;
  stressAvg: number | null;
}

export interface SignCount {
  text: string;
  days: number;
}

export interface VisitTopic {
  id: string;
  text: string;
  createdAt: string;
}

export interface VisitSummary {
  from: DateKey;
  to: DateKey;
  days: VisitDay[];
  counts: Record<Level | 'none', number>;
  sleepAvg: number | null;
  stressAvg: number | null;
  /** Signs that gave points, by the direction the plan gives them. */
  signs: Record<Polarity, SignCount[]>;
  /** Routines ticked off: on how many of the days with any tick. */
  routines: { text: string; done: number; logged: number }[];
  /** The steps answered the day after a red day. */
  redSteps: { date: DateKey; steps: { text: string; done: boolean }[] }[];
  topics: VisitTopic[];
}

const avg = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null);

export function buildVisitSummary(input: {
  today: DateKey;
  days: 14 | 30;
  entries: Entry[];
  assessments: Assessment[];
  context: ContextEntry[];
  plan: PlanItem[];
  measured: Record<DateKey, MeasuredDay>;
  topics: VisitTopic[];
}): VisitSummary {
  const from = addDays(input.today, -(input.days - 1));
  const byEntry = new Map(input.assessments.map((a) => [a.entryId, a]));
  const entryOn = new Map(input.entries.map((e) => [e.date, e]));
  const days: VisitDay[] = [];
  const counts: VisitSummary['counts'] = { green: 0, yellow: 0, red: 0, none: 0 };
  const signDays: Record<Polarity, Map<string, Set<DateKey>>> = { up: new Map(), down: new Map(), both: new Map() };
  const polarityOf = new Map(input.plan.map((p) => [p.id, p.plan?.polarity ?? 'both']));

  for (let i = 0; i < input.days; i++) {
    const date = addDays(from, i);
    const e = entryOn.get(date);
    const a = e ? byEntry.get(e.id) : undefined;
    const m = input.measured[date];
    days.push({ date, level: a?.level ?? null, sleepHours: m?.sleepHours ?? e?.sleepHours ?? null, stressAvg: m?.stressAvg ?? e?.stressAvg ?? null });
    counts[a?.level ?? 'none']++;
    for (const s of a?.signals ?? []) {
      if ((s.kind !== 'early_sign' && s.kind !== 'serious_sign') || s.points <= 0) continue;
      const pol = (s.planItemId && (polarityOf.get(s.planItemId) ?? a?.inputs?.signs.find((x) => x.id === s.planItemId)?.plan?.polarity)) || 'both';
      const map = signDays[pol];
      map.set(s.label, (map.get(s.label) ?? new Set()).add(date));
    }
  }

  const ticks = input.context.filter((c) => c.kind === 'routine_done' && c.date && c.date >= from && c.date <= input.today);
  const logged = new Set(ticks.map((t) => t.date)).size;
  const routineRows = routines(input.context)
    .map((r) => ({ text: r.text, done: new Set(ticks.filter((t) => t.routineId === r.id && t.done).map((t) => t.date)).size, logged }))
    .filter((r) => logged > 0);

  const sorted = (m: Map<string, Set<DateKey>>) => [...m.entries()].map(([text, d]) => ({ text, days: d.size })).sort((a, b) => b.days - a.days || a.text.localeCompare(b.text));
  return {
    from,
    to: input.today,
    days,
    counts,
    sleepAvg: avg(days.map((d) => d.sleepHours).filter((v): v is number => v != null)),
    stressAvg: avg(days.map((d) => d.stressAvg).filter((v): v is number => v != null)),
    signs: { up: sorted(signDays.up), down: sorted(signDays.down), both: sorted(signDays.both) },
    routines: routineRows,
    redSteps: redStepsBetween(input.context, addDays(from, -1), input.today),
    topics: input.topics,
  };
}
