// "Räkna om historiken med nya regler" (B3): computes every saved day again with the rules
// in rules/rules.json, from the inputs saved with each assessment. No model is asked again:
// the signs that matched then are kept, so only the rules can change the result. Nothing is
// saved here; the caller shows the difference and saves only when the person agrees.

import type { Assessment, Entry, GarminDay, DateKey, Level, PlanItem, PlanSettings, RhythmScoreInput, SignMatch } from '../domain/types';
import { RULES_VERSION } from './rules';
import { score, type HistoryDay } from './scoring';
import { assessmentRhythm } from './assess';

export interface RecomputeContext {
  /** For days saved before inputs existed: today's plan, settings, Garmin days and medication answers. */
  plan: PlanItem[];
  planSettings: PlanSettings;
  garmin: Record<DateKey, GarminDay>;
  medication: Record<DateKey, boolean>;
  /** Klockans rytm per day, to show the effect of using it or not; defaults to what was saved. */
  rhythm?: (date: DateKey, saved: RhythmScoreInput | null) => RhythmScoreInput | null;
}

export interface RecomputedDay {
  date: DateKey;
  entryId: string;
  before: { level: Level; points: number; rulesVersion: string | null };
  after: { level: Level; points: number };
  changed: boolean;
  /** The day's mood was read again since the day was assessed: from, to. */
  moodReread?: { from: number; to: number };
  /** True when the day had no saved inputs and today's plan and values were used. */
  approximate: boolean;
  next: Assessment;
}

function matchesOf(a: Assessment): SignMatch[] {
  if (a.inputs) return a.inputs.matches;
  return a.signals.filter((s) => s.planItemId && (s.kind === 'early_sign' || s.kind === 'serious_sign')).map((s) => ({ planItemId: s.planItemId!, quote: s.quote ?? '' }));
}

/** One day again, with the levels of the days before as they come out of the new rules. */
export function recomputeAssessment(a: Assessment, entry: Entry, history: HistoryDay[], ctx: RecomputeContext, now = new Date()): Assessment {
  const inp = a.inputs;
  const plan = inp?.signs ?? ctx.plan;
  const planSettings = inp ? { ...ctx.planSettings, ...inp.planSettings } : ctx.planSettings;
  const rhythmIn = ctx.rhythm ? ctx.rhythm(entry.date, inp?.rhythm ?? null) : inp?.rhythm ?? null;
  const scored = score({
    entry,
    matches: matchesOf(a),
    plan,
    planSettings,
    history,
    garmin: inp?.garmin ?? ctx.garmin,
    medication: inp?.medication ?? ctx.medication,
    // Observations the person said did not fit are left out (Mina tidigare texter).
    textObservations: (inp?.textObservations ?? []).filter((o) => !a.textPatterns?.observations.some((x) => x.patternId === o.patternId && x.quote === o.quote && x.rejectedAt)),
    // Klockans rytm as it stood that morning; ctx.rhythm can try another choice (with or without).
    rhythm: rhythmIn,
  });
  // The emergency rule is decided before any rule and stays as it was.
  if (a.akut) {
    scored.signals.unshift({ kind: 'akut', points: 0, label: 'Formulering om att inte vilja leva eller att skada sig', measured: false });
    scored.level = 'red';
    scored.reason = 'akut';
  }
  // Signs found by the person's own diary import keep their own labels and points rule; the
  // rated mood is counted again, since an imported day's mood can be read again (schema 6).
  const signals = a.method === 'import' && !inp
    ? [...a.signals.filter((s) => s.kind !== 'mood_rated'), ...scored.signals.filter((s) => s.kind === 'mood_rated')]
    : scored.signals;
  return {
    ...a,
    level: scored.level,
    points: scored.points,
    signals,
    levelReason: scored.reason,
    recentNonGreenDays: scored.recentNonGreenDays,
    baseline: scored.baseline,
    ...(scored.level === 'green' && scored.trend.length ? { trend: scored.trend } : { trend: undefined }),
    inputs: inp ? { ...inp, rulesVersion: RULES_VERSION, baseline: scored.baseline } : undefined,
    textPatterns: a.textPatterns
      ? {
        ...a.textPatterns,
        levelWithout: scored.withoutText.level,
        pointsWithout: scored.withoutText.points,
        observations: a.textPatterns.observations.map((o) => {
          const r = scored.textOutcomes.find((x) => x.patternId === o.patternId && x.quote === o.quote);
          return { ...o, counted: !!r?.counted && !o.rejectedAt, reason: o.rejectedAt ? 'Du sa att den inte stämde' : o.reason && !r ? o.reason : r?.reason ?? null };
        }),
      }
      : a.textPatterns,
    ...(rhythmIn && scored.rhythm ? { rhythm: assessmentRhythm(rhythmIn, scored.rhythm) } : {}),
    recomputed: { at: now.toISOString(), fromRulesVersion: inp?.rulesVersion ?? null, level: a.level, points: a.points },
  };
}

/** Every day, oldest first. Later days see the new levels of earlier days. */
export function recomputeHistory(entries: Entry[], assessments: Assessment[], ctx: RecomputeContext, now = new Date()): RecomputedDay[] {
  const byEntry = new Map(assessments.map((a) => [a.entryId, a]));
  const sorted = [...entries].sort((x, y) => x.date.localeCompare(y.date) || x.createdAt.localeCompare(y.createdAt));
  const history: HistoryDay[] = [];
  const out: RecomputedDay[] = [];
  for (const entry of sorted) {
    const a = byEntry.get(entry.id);
    if (!a) {
      history.push({ entry, level: null });
      continue;
    }
    const next = recomputeAssessment(a, entry, history, ctx, now);
    out.push({
      date: entry.date,
      entryId: entry.id,
      before: { level: a.level, points: a.points, rulesVersion: a.inputs?.rulesVersion ?? null },
      after: { level: next.level, points: next.points },
      changed: next.level !== a.level || next.points !== a.points,
      ...(rereadSince(entry, a) && entry.mood != null ? { moodReread: { from: entry.moodReread!.was, to: entry.mood } } : {}),
      approximate: !a.inputs,
      next,
    });
    history.push({ entry, level: next.level });
  }
  return out;
}

/** When the day's level was last computed: recomputed, or else first assessed. */
const computedAt = (a: Assessment) => a.recomputed?.at ?? a.createdAt;

/** True when the day's mood was read again after its level was last computed. */
function rereadSince(entry: Entry, a: Assessment): boolean {
  return !!entry.moodReread && computedAt(a) < entry.moodReread.at;
}

/** Imported days whose mood was read again after their level was computed. */
export function rereadDays(entries: Entry[], assessments: Assessment[]): number {
  const byEntry = new Map(assessments.map((a) => [a.entryId, a]));
  return entries.filter((e) => {
    const a = byEntry.get(e.id);
    return !!a && rereadSince(e, a);
  }).length;
}

/** Days computed with other rules than the current ones. */
export function outdatedDays(assessments: Assessment[]): number {
  return assessments.filter((a) => (a.inputs?.rulesVersion ?? null) !== RULES_VERSION).length;
}
