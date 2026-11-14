// Builds a full assessment: match signs (word matching or, from step 2, a language model),
// score in code, and pick the plan's own actions for the level.

import { buildContext, entriesFromPlan, type PromptContext } from '../context/buildContext';
import type {
  Assessment, AssessmentInputs, ContextEntry, DateKey, Entry, GarminDay, Level, MatchMethod, PlanItem, PlanSettings, Polarity, Signal, SignMatch,
  TextComparison, TextObservationInput,
  AssessmentRhythm, RhythmScoreInput,
} from '../domain/types';
import { actionsFor } from '../plan/guidance';
import { matchSigns, tokenize, wordsMatch } from './wordmatch';
import { score, type HistoryDay, type ScoreResult } from './scoring';
import type { CheckedObservation, TextComparerResult } from '../references/patterns';
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

/** Words that name what a measured sign is about, so "Du sov 4,5 timmar" fits a sleep sign. */
const TOPIC: Partial<Record<Signal['kind'], string[]>> = {
  sleep_low: ['sov', 'sömn', 'natt', 'nätt'],
  sleep_low_consecutive: ['sov', 'sömn', 'natt', 'nätt'],
  late_sleep_no_entry: ['sov', 'sömn', 'somna', 'insomn', 'natt', 'sent'],
  stress_high: ['stress'],
  night_entry: ['natt', 'sent'],
  silence: ['inlägg', 'tyst', 'dagar'],
  medication_missed: ['medicin', 'tablett'],
  mood_rated: ['stämning', 'humör', 'mani', 'depression', 'nedstämd', 'uppvarv'],
  mood_jump: ['stämning', 'humör'],
  energy_jump: ['energi', 'ork'],
  heavy_day: ['tung', 'ork'],
};

/** A model sentence fits when it is short and speaks of something that gave points. */
export function sentenceFits(sentence: string, signals: Signal[]): boolean {
  if (sentence.length > 300) return false;
  const words = tokenize(sentence);
  return signals.filter((s) => s.points > 0).some((s) => {
    const about = tokenize(`${s.label} ${s.quote ?? ''}`).filter((w) => w.length >= 4);
    if (words.some((w) => w.length >= 4 && about.some((t) => wordsMatch(w, t)))) return true;
    return (TOPIC[s.kind] ?? []).some((t) => words.some((w) => w.startsWith(t)));
  });
}

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
export const SERIOUS_MOOD_INTRO = 'Du skattade stämningen som akut. Din plan säger att du då ska:';

/** The intro to the plan's steps at red: a serious sign from the plan, or a rating of ±3. */
export function seriousIntro(a: Pick<Assessment, 'signals'>): string {
  return a.signals.some((s) => s.kind === 'serious_sign' && s.points > 0) ? SERIOUS_INTRO : SERIOUS_MOOD_INTRO;
}

/**
 * The plan's actions at red when one of the user's serious signs matched, whatever the
 * level: a serious sign alone gives yellow, but the plan's red steps still apply. Null
 * when no serious sign counted, and for the emergency rule, which has its own card.
 */
export function seriousActions(a: Pick<Assessment, 'signals' | 'akut'>, plan: PlanItem[], dir: Polarity | null = null): PlanItem[] | null {
  if (a.akut) return null;
  if (!a.signals.some((s) => (s.kind === 'serious_sign' || s.serious) && s.points > 0)) return null;
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
  /** Why the match was mild: a negation, or the past, someone else or a topic. */
  akutMildBecause?: 'negation' | 'context';
  /**
   * Mina tidigare texter: compares the note with approved personal patterns. Never called when
   * the emergency rule matched, fully or mildly: such a note is never sent to a model.
   */
  textComparer?: () => Promise<TextComparerResult | null>;
  /** Dygnsrytm for the day (experimental): shown with and without, counted only when chosen. */
  rhythm?: RhythmScoreInput | null;
  now?: Date;
}): Promise<Assessment> {
  const { entry, plan, planSettings, history, matcher, garmin } = args;
  const bank = args.context ?? entriesFromPlan(plan, planSettings.normalState);
  const built = buildContext({ entries: bank, entry, history, garmin }, planSettings);
  const signs = built.signs;
  // The comparison with earlier texts runs alongside the sign matching.
  const textRun: Promise<TextComparerResult | null> = args.textComparer && !args.akut && !args.akutMild && entry.transcript.trim()
    ? args.textComparer().catch((e: Error) => ({ check: null, error: e.message || 'okänt fel', model: null, promptId: 'textjamforelse', promptVersion: '?', referenceVersion: '?', referenceIds: [], patternIds: [], stableMissing: true }))
    : Promise.resolve(null);
  let result: MatchResult;
  try {
    result = await matcher.match(entry.transcript, signs, planSettings, { variables: built.variables });
  } catch {
    // Any failure falls back to word matching, and the method shows it.
    result = { ...(await wordMatcher.match(entry.transcript, signs, planSettings)), method: 'llm_fallback' };
  }
  const medication: Record<DateKey, boolean> = {};
  for (const e of bank) if (e.kind === 'medication_taken' && e.date && e.taken != null) medication[e.date] = e.taken;
  // The model reads the note better than word matching, but it must not be able to hide a
  // serious sign: one that word matching finds on the phone always counts. Other differences
  // are kept and shown under Så räknade appen.
  let matches = result.matches;
  const keptByPhone: SignMatch[] = [];
  const wordOnly: SignMatch[] = [];
  if (result.method === 'llm' && entry.transcript.trim()) {
    const kindOf = new Map(signs.map((s) => [s.id, s.kind]));
    const have = new Set(matches.map((m) => m.planItemId));
    for (const m of matchSigns(entry.transcript, signs)) {
      if (have.has(m.planItemId)) continue;
      if (kindOf.get(m.planItemId) === 'serious') keptByPhone.push(m);
      else wordOnly.push(m);
    }
    matches = [...matches, ...keptByPhone];
  }
  const text = await textRun;
  const textObservations = (text?.check?.observations ?? []).filter((o) => o.eligible).map(toInput);
  const scored = score({ entry, matches, plan, planSettings, history, garmin, medication, textObservations, rhythm: args.rhythm ?? null });
  // Everything needed to compute the level again: the days the rules look back at, the signs and matches.
  const lookback = Math.max(RULES.trendDays, RULES.medicationMissedDays, 2);
  const days = Array.from({ length: lookback + 1 }, (_, i) => addDays(entry.date, -i));
  const inputs: AssessmentInputs = {
    rulesVersion: RULES_VERSION,
    sentText: result.sent ?? null,
    rawAnswer: result.raw ?? null,
    signs,
    matches,
    planSettings: { sleepThresholdHours: planSettings.sleepThresholdHours },
    garmin: Object.fromEntries(days.filter((d) => garmin?.[d]).map((d) => [d, garmin![d]])),
    medication: Object.fromEntries(days.filter((d) => medication[d] != null).map((d) => [d, medication[d]])),
    baseline: scored.baseline,
    ...(textObservations.length ? { textObservations } : {}),
    ...(args.rhythm ? { rhythm: args.rhythm } : {}),
  };
  if (args.akut) {
    // The emergency rule always gives red, whatever the points and also in standard mode.
    scored.signals.unshift({ kind: 'akut', points: 0, label: 'Formulering om att inte vilja leva eller att skada sig', measured: false });
    scored.level = 'red';
    scored.reason = 'akut';
  }
  // The model's sentence only when it speaks of something that gave points; otherwise the
  // template, so an odd or steered sentence ("allt är bra") never stands over a yellow day.
  const modelSentence = result.sentence?.trim() || null;
  const usable = modelSentence && sentenceFits(modelSentence, scored.signals);
  const sentence = args.akut
    ? AKUT_SENTENCE
    : scored.level === 'green'
      ? GREEN_SENTENCE
      : usable ? modelSentence : templateSentence(scored.signals);
  if (keptByPhone.length) inputs.keptByPhone = keptByPhone;
  if (wordOnly.length) inputs.wordOnly = wordOnly;
  if (modelSentence && !usable && scored.level !== 'green' && !args.akut) inputs.sentenceDropped = modelSentence;
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
    ...(args.akutMild && !args.akut ? { akutMild: true, ...(args.akutMildBecause ? { akutMildBecause: args.akutMildBecause } : {}) } : {}),
    ...(scored.level === 'green' && scored.trend.length ? { trend: scored.trend } : {}),
    inputs,
    ...(text ? { textPatterns: textComparison(text, scored) } : {}),
    ...(args.rhythm && scored.rhythm ? { rhythm: assessmentRhythm(args.rhythm, scored.rhythm) } : {}),
  };
}

/** The passive estimate as saved with the day: apart from the rated mood, with the level with and without it. */
export function assessmentRhythm(r: RhythmScoreInput, s: NonNullable<ScoreResult['rhythm']>): AssessmentRhythm {
  return {
    date: r.date,
    computedAt: r.computedAt,
    status: r.status,
    direction: r.direction,
    text: r.text,
    used: s.used,
    points: s.used ? s.signal?.points ?? 0 : 0,
    withRhythm: s.with,
    withoutRhythm: s.without,
  };
}

function toInput(o: CheckedObservation): TextObservationInput {
  return { patternId: o.patternId, quote: o.quote, direction: o.direction, phenomenon: o.phenomenon, planSignId: o.planSignId, description: o.description, referenceIds: o.referenceIds, note: o.note };
}

/** What Mina tidigare texter did to the day, saved for review: every observation and why it counted or not. */
export function textComparison(text: TextComparerResult, scored: Pick<ScoreResult, 'textOutcomes' | 'withoutText'>): TextComparison {
  const outcome = (o: CheckedObservation) => scored.textOutcomes.find((x) => x.patternId === o.patternId && x.quote === o.quote);
  return {
    rulesVersion: RULES_VERSION,
    model: text.model,
    promptId: text.promptId,
    promptVersion: text.promptVersion,
    referenceVersion: text.referenceVersion,
    referenceIds: text.referenceIds,
    patternIds: text.patternIds,
    abstained: !!text.check?.abstained,
    abstainReason: text.check?.abstainReason ?? null,
    observations: (text.check?.observations ?? []).map((o) => {
      const r = outcome(o);
      return { ...toInput(o), perspective: o.perspective, counted: !!r?.counted, reason: o.reason ?? r?.reason ?? null };
    }),
    differences: text.check?.differences ?? [],
    uncertainties: text.check?.uncertainties ?? [],
    stableMissing: text.stableMissing,
    levelWithout: scored.withoutText.level,
    pointsWithout: scored.withoutText.points,
    error: text.error,
  };
}
