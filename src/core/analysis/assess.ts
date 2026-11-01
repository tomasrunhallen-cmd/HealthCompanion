// Builds a full assessment: match signs (word matching or, from step 2, a language model),
// score in code, and pick the plan's own actions for the level.

import { buildContext, entriesFromPlan, type PromptContext } from '../context/buildContext';
import type {
  Assessment, AssessmentInputs, ContextEntry, DateKey, Entry, GarminDay, Level, MatchMethod, PlanItem, PlanSettings, Polarity, Signal, SignMatch,
} from '../domain/types';
import { actionsFor } from '../plan/guidance';
import { matchSigns } from './wordmatch';
import { score, type HistoryDay } from './scoring';
import { addDays } from './dates';
import { RULES, RULES_VERSION } from './rules';

export const NOTHING_STANDS_OUT = 'Inget i anteckningen avviker från ditt normalläge.';
/** Green always says this, whatever the model wrote: never that all is well. */
export const GREEN_SENTENCE = 'Inget av dina tecken syntes i dag.';
export const AKUT_SENTENCE = 'Det du skrev låter som att du har det mycket svårt just nu. Du behöver inte vara ensam med det.';

export interface MatchResult {
  matches: SignMatch[];
  /** Sentence written by a model. Word matching leaves it empty and a template is used. */
  sentence: string | null;
  method: MatchMethod;
  model: string | null;
  promptId: string | null;
  promptVersion: string | null;
  /** The note as sent to a model, scrubbed. */
  sent?: string | null;
  /** The model's answer as it came back. */
  raw?: string | null;
}

export interface MatchContext {
  /** Everything buildContext put together for the prompt, before scrubbing. */
  variables: PromptContext;
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

/** The sentence to show. Green assessments saved before the fixed text get it too. */
export function displaySentence(a: Pick<Assessment, 'level' | 'sentence' | 'akut'>): string {
  return a.level === 'green' && !a.akut ? GREEN_SENTENCE : a.sentence;
}

/** The person's own actions for a level; with a direction, those for it and for both. See plan/guidance.ts. */
export function actionsForLevel(level: Level, plan: PlanItem[], dir: Polarity | null = null): PlanItem[] {
  return actionsFor(level, plan, dir);
}

export const SERIOUS_INTRO = 'Ett av dina allvarliga tecken syntes. Din plan säger att du då ska:';

/**
 * The plan's actions at red when one of the user's serious signs matched, whatever the
 * level: a serious sign alone gives yellow, but the plan's red steps still apply. Null
 * when no serious sign counted, and for the emergency rule, which has its own card.
 */
export function seriousActions(a: Pick<Assessment, 'signals' | 'akut'>, plan: PlanItem[], dir: Polarity | null = null): PlanItem[] | null {
  if (a.akut) return null;
  if (!a.signals.some((s) => s.kind === 'serious_sign' && s.points > 0)) return null;
  return actionsForLevel('red', plan, dir);
}

export function firstStep(level: 'yellow' | 'red', plan: PlanItem[], dir: Polarity | null = null): PlanItem | null {
  return actionsForLevel(level, plan, dir)[0] ?? null;
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
  /** The context bank. Without it, a bank is made from the plan alone. */
  context?: ContextEntry[];
  /** The note matched the emergency word list (checked by the caller, before any model). */
  akut?: boolean;
  /** A negated match: shown gently, the level is computed as usual. */
  akutMild?: boolean;
  now?: Date;
}): Promise<Assessment> {
  const { entry, plan, planSettings, history, matcher, garmin } = args;
  const bank = args.context ?? entriesFromPlan(plan, planSettings.normalState);
  const built = buildContext({ entries: bank, entry, history, garmin }, planSettings);
  const signs = built.signs;
  let result: MatchResult;
  try {
    result = await matcher.match(entry.transcript, signs, planSettings, { variables: built.variables });
  } catch {
    // Any failure falls back to word matching, and the method shows it.
    result = { ...(await wordMatcher.match(entry.transcript, signs, planSettings)), method: 'llm_fallback' };
  }
  const medication: Record<DateKey, boolean> = {};
  for (const e of bank) if (e.kind === 'medication_taken' && e.date && e.taken != null) medication[e.date] = e.taken;
  const scored = score({ entry, matches: result.matches, plan, planSettings, history, garmin, medication });
  // Everything needed to compute the level again: the days the rules look back at, the signs and matches.
  const lookback = Math.max(RULES.trendDays, RULES.medicationMissedDays, 2);
  const days = Array.from({ length: lookback + 1 }, (_, i) => addDays(entry.date, -i));
  const inputs: AssessmentInputs = {
    rulesVersion: RULES_VERSION,
    sentText: result.sent ?? null,
    rawAnswer: result.raw ?? null,
    signs,
    matches: result.matches,
    planSettings: { sleepThresholdHours: planSettings.sleepThresholdHours },
    garmin: Object.fromEntries(days.filter((d) => garmin?.[d]).map((d) => [d, garmin![d]])),
    medication: Object.fromEntries(days.filter((d) => medication[d] != null).map((d) => [d, medication[d]])),
    baseline: scored.baseline,
  };
  if (args.akut) {
    // The emergency rule always gives red, whatever the points and also in standard mode.
    scored.signals.unshift({ kind: 'akut', points: 0, label: 'Formulering om att inte vilja leva eller att skada sig', measured: false });
    scored.level = 'red';
    scored.reason = 'akut';
  }
  const sentence = args.akut
    ? AKUT_SENTENCE
    : scored.level === 'green'
      ? GREEN_SENTENCE
      : result.sentence?.trim() || templateSentence(scored.signals);
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
    ...(args.akut ? { akut: true } : {}),
    ...(args.akutMild && !args.akut ? { akutMild: true } : {}),
    ...(scored.level === 'green' && scored.trend.length ? { trend: scored.trend } : {}),
    inputs,
  };
}
