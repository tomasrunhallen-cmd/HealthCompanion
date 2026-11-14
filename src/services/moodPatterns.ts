// Mina mönster, the phone's side: runs the analysis about once a month and on request, keeps
// each finding as a hypothesis with the day it was found, and, only when the person has chosen
// it, lets a language model word a short explanation of a finding the code has already verified.
// The analysis itself never leaves the phone. To a model go only the finding's counts
// (findingFacts): no dates, no notes, nothing the person wrote.

import { daysBetween, toDateKey } from '../core/analysis/dates';
import {
  analysePatterns, checkExplanation, findingFacts, findingTitle, followUp, hypothesisOf, PATTERN_PARAMS,
  type CandidateResult, type FollowUp, type PatternAnalysis, type PatternHypothesis,
} from '../core/analysis/moodPatterns';
import type { DateKey } from '../core/domain/types';
import { scrub } from '../core/privacy/scrub';
import { loadPrompt } from '../core/prompts/loader';
import type { Repository } from '../storage/repository';
import { activeAdapter, namesToScrub, trackedCompleter, type AdapterOptions } from './llm';
import { activityDays, episodeStarts, watchNights } from './rhythm';

export const MOOD_PATTERNS_KEY = 'moodPatterns';
/** The analysis is made again when the last one is this old. */
export const RUN_EVERY_DAYS = 30;

export interface StoredExplanation {
  text: string;
  /** The facts it was written from: shown only while the finding's numbers are the same. */
  facts: string;
  model: string;
  promptVersion: string;
  createdAt: string;
}

export interface PatternStore {
  analysis: PatternAnalysis | null;
  hypotheses: PatternHypothesis[];
  explanations: Record<string, StoredExplanation>;
  /** Findings the person has opened: no card on Hem for them. */
  seen: string[];
}

export function patternStore(repo: Repository): PatternStore {
  const s = repo.kvGet(MOOD_PATTERNS_KEY) as Partial<PatternStore> | undefined;
  return { analysis: s?.analysis ?? null, hypotheses: s?.hypotheses ?? [], explanations: s?.explanations ?? {}, seen: s?.seen ?? [] };
}

/** The person's own ratings, one per day. A day without a rating is left out, never counted as balanced. */
export function ratingsOf(repo: Repository): Record<DateKey, number> {
  const out: Record<DateKey, number> = {};
  for (const e of repo.entries()) if (typeof e.mood === 'number') out[e.date] = e.mood;
  return out;
}

/** On only when the person has chosen it. It also needs a connected model. */
export function patternExplanationsOn(repo: Repository): boolean {
  return repo.settings().patternExplanations === true;
}

/** Runs the analysis on what is saved, and keeps new findings as hypotheses. */
export async function runPatterns(repo: Repository, now = new Date(), opts: AdapterOptions = {}): Promise<PatternAnalysis> {
  const analysis = analysePatterns(
    { measured: watchNights(repo), activity: activityDays(repo), episodes: episodeStarts(repo), ratings: ratingsOf(repo) },
    toDateKey(now),
    now.toISOString(),
  );
  const before = patternStore(repo);
  const known = new Set(before.hypotheses.map((h) => h.candidateId));
  const hypotheses = [...before.hypotheses, ...analysis.findings.filter((f) => !known.has(f.candidate.id)).map((f) => hypothesisOf(f, analysis))];
  await repo.kvSet(MOOD_PATTERNS_KEY, { ...before, analysis, hypotheses } satisfies PatternStore);
  if (patternExplanationsOn(repo)) await explainFindings(repo, opts).catch(() => null);
  return analysis;
}

/** When the app opens: the monthly analysis, if it is due and there is enough to look at. Never throws. */
export async function ensureMonthlyPatterns(repo: Repository, now = new Date()): Promise<void> {
  try {
    const last = patternStore(repo).analysis;
    if (last && daysBetween(last.to, toDateKey(now)) < RUN_EVERY_DAYS) return;
    if (Object.keys(watchNights(repo)).length < PATTERN_PARAMS.minNights || Object.keys(ratingsOf(repo)).length < PATTERN_PARAMS.minRatedDays) return;
    await runPatterns(repo, now);
  } catch {
    // Next time the app opens.
  }
}

export interface ShownFinding {
  hypothesis: PatternHypothesis;
  /** The link counted on everything saved up to the latest analysis. */
  result: CandidateResult;
  /** The same count on data after the day it was found. */
  later: FollowUp;
  explanation: StoredExplanation | null;
}

/** At most two findings for the page, one per direction of mood: those the latest analysis still finds first, then the newest. */
export function shownFindings(repo: Repository): ShownFinding[] {
  const s = patternStore(repo);
  const a = s.analysis;
  if (!a) return [];
  const rank = (h: PatternHypothesis) => { const i = a.findings.findIndex((f) => f.candidate.id === h.candidateId); return i < 0 ? 99 : i; };
  return [...s.hypotheses]
    .sort((x, y) => rank(x) - rank(y) || y.foundAt.localeCompare(x.foundAt))
    .map((h): ShownFinding | null => {
      const result = a.results.find((r) => r.candidate.id === h.candidateId);
      const later = followUp(h, a);
      if (!result || !later) return null;
      const ex = s.explanations[h.candidateId];
      return { hypothesis: h, result, later, explanation: ex && ex.facts === sentFacts(repo, result, a) ? ex : null };
    })
    .filter((x): x is ShownFinding => x != null)
    // One per direction of mood, as in the analysis: an older hypothesis in the same direction stays saved but is not shown beside it.
    .filter((x, i, all) => all.findIndex((y) => y.result.candidate.mood === x.result.candidate.mood) === i)
    .slice(0, PATTERN_PARAMS.maxFindings);
}

/** The card on Hem: one finding the person has not opened yet. */
export function patternCard(repo: Repository): { id: string; finding: ShownFinding } | null {
  const seen = patternStore(repo).seen;
  const f = shownFindings(repo).find((x) => !seen.includes(x.hypothesis.candidateId));
  return f ? { id: `pattern_${f.hypothesis.candidateId}`, finding: f } : null;
}

export async function markPatternsSeen(repo: Repository): Promise<void> {
  const s = patternStore(repo);
  const ids = s.hypotheses.map((h) => h.candidateId);
  if (ids.every((id) => s.seen.includes(id))) return;
  await repo.kvSet(MOOD_PATTERNS_KEY, { ...s, seen: Array.from(new Set([...s.seen, ...ids])) } satisfies PatternStore);
}

// ---- the language model: wording only, and only when chosen ----

/** Exactly what is sent for one finding: its counts, through scrub() like everything sent to a model. */
function sentFacts(repo: Repository, r: CandidateResult, a: PatternAnalysis): string {
  return scrub(findingFacts(r, a), namesToScrub(repo)).text;
}

/** What would be sent, for the page: shown before the person turns the explanation on, and after. */
export function outgoingFacts(repo: Repository): { title: string; sent: string }[] {
  const a = patternStore(repo).analysis;
  if (!a) return [];
  return shownFindings(repo).map((f) => ({ title: findingTitle(f.result), sent: sentFacts(repo, f.result, a) }));
}

export async function setPatternExplanations(repo: Repository, on: boolean, opts: AdapterOptions = {}): Promise<void> {
  await repo.updateSettings({ patternExplanations: on });
  if (on) await explainFindings(repo, opts).catch(() => null);
}

/**
 * Asks the model to word each shown finding that has no explanation for its current numbers.
 * The answer is checked against the same facts; one that does not hold is dropped and nothing
 * is shown in its place. Returns how many were written and how many were dropped.
 */
export async function explainFindings(repo: Repository, opts: AdapterOptions = {}): Promise<{ made: number; dropped: number }> {
  const out = { made: 0, dropped: 0 };
  if (!patternExplanationsOn(repo)) return out;
  const a = patternStore(repo).analysis;
  if (!a) return out;
  const todo = shownFindings(repo).filter((f) => !f.explanation);
  if (!todo.length) return out;
  const adapter = await activeAdapter(repo, opts);
  if (!adapter) return out;
  const prompt = loadPrompt('monsterforklaring');
  const completer = trackedCompleter(repo, adapter, opts.now);
  for (const f of todo) {
    const facts = sentFacts(repo, f.result, a);
    let text: string | null = null;
    try {
      const res = await completer.complete(prompt, { uppgifter: facts });
      text = checkExplanation(res.json, facts);
    } catch {
      text = null;
    }
    if (!text) { out.dropped++; continue; }
    const s = patternStore(repo);
    await repo.kvSet(MOOD_PATTERNS_KEY, {
      ...s,
      explanations: { ...s.explanations, [f.hypothesis.candidateId]: { text, facts, model: adapter.model, promptVersion: String(prompt.meta.version), createdAt: (opts.now?.() ?? new Date()).toISOString() } },
    } satisfies PatternStore);
    out.made++;
  }
  return out;
}
