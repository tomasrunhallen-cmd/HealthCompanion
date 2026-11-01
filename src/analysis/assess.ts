// Builds a full assessment: match signs (word matching or, from step 2, a language model),
// score in code, and pick the plan's own actions for the level.

import type {
  Assessment, DateKey, Entry, GarminDay, Level, MatchMethod, PlanItem, PlanSettings, Signal, SignMatch,
} from '../domain/types';
import { formatMeasurements, measuredDays } from './measurements';
import { matchSigns } from './wordmatch';
import { computeBaseline, score, type HistoryDay } from './scoring';

export const NOTHING_STANDS_OUT = 'Inget i anteckningen avviker från ditt normalläge.';

export interface MatchResult {
  matches: SignMatch[];
  /** Sentence written by a model. Word matching leaves it empty and a template is used. */
  sentence: string | null;
  method: MatchMethod;
  model: string | null;
  promptId: string | null;
  promptVersion: string | null;
}

export interface MatchContext {
  /** Today's and the past week's measured sleep and stress, as text for the model. */
  measurements: string;
}

export interface SignMatcher {
  match(note: string, signs: PlanItem[], planSettings: PlanSettings, context?: MatchContext): Promise<MatchResult>;
}

export const wordMatcher: SignMatcher = {
  async match(note, signs) {
    return {
      matches: note.trim() ? matchSigns(note, signs) : [],
      sentence: null,
      method: note.trim() ? 'wordmatch' : 'none',
      model: null,
      promptId: null,
      promptVersion: null,
    };
  },
};

/** Calm one-sentence summary built only from the user's own words and measured facts. */
export function templateSentence(signals: Signal[]): string {
  const sign =
    signals.find((s) => s.kind === 'serious_sign') ?? signals.find((s) => s.kind === 'early_sign');
  if (sign) return `Det tydligaste i dag liknar ett av dina tecken: ”${sign.label}”.`;
  const first = signals[0];
  if (first) return `Det som stack ut i dag: ${first.label.charAt(0).toLowerCase()}${first.label.slice(1)}.`;
  return NOTHING_STANDS_OUT;
}

export function actionsForLevel(level: Level, plan: PlanItem[]): PlanItem[] {
  const kind = level === 'red' ? 'action_red' : level === 'yellow' ? 'action_yellow' : null;
  if (!kind) return [];
  return plan.filter((p) => p.kind === kind).sort((a, b) => a.order - b.order);
}

export function firstStep(level: 'yellow' | 'red', plan: PlanItem[]): PlanItem | null {
  return actionsForLevel(level, plan)[0] ?? null;
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function assessEntry(args: {
  entry: Entry;
  plan: PlanItem[];
  planSettings: PlanSettings;
  history: HistoryDay[];
  matcher: SignMatcher;
  /** Measured days from Garmin, keyed by calendar date. */
  garmin?: Record<DateKey, GarminDay>;
  now?: Date;
}): Promise<Assessment> {
  const { entry, plan, planSettings, history, matcher, garmin } = args;
  const signs = plan.filter((p) => p.kind === 'early' || p.kind === 'serious');
  const earlier = history.filter((h) => h.entry.date < entry.date);
  const measurements = formatMeasurements(
    measuredDays(entry, earlier, garmin),
    computeBaseline(entry.date, earlier).stressAvg,
  );
  let result: MatchResult;
  try {
    result = await matcher.match(entry.transcript, signs, planSettings, { measurements });
  } catch {
    // Any failure falls back to word matching, and the method shows it.
    result = { ...(await wordMatcher.match(entry.transcript, signs, planSettings)), method: 'llm_fallback' };
  }
  const scored = score({ entry, matches: result.matches, plan, planSettings, history, garmin });
  const sentence = result.sentence?.trim() || templateSentence(scored.signals);
  return {
    id: newId('a'),
    entryId: entry.id,
    date: entry.date,
    createdAt: (args.now ?? new Date()).toISOString(),
    level: scored.level,
    points: scored.points,
    signals: scored.signals,
    sentence,
    method: result.method,
    model: result.model,
    promptId: result.promptId,
    promptVersion: result.promptVersion,
    baseline: scored.baseline,
    levelReason: scored.reason,
    recentNonGreenDays: scored.recentNonGreenDays,
  };
}
