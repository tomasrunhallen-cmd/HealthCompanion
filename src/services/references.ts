// Mina tidigare texter (experimental, personal use): the person's earlier texts as reference
// material, personal patterns the model proposes from them, and the evening comparison that
// can add points to the day. Everything is stored in the app's own (encrypted) storage, and
// nothing is sent before the person has seen the preview and turned the comparison on.

import { GREEN_SENTENCE, templateSentence } from '../core/analysis/assess';
import { recomputeAssessment } from '../core/analysis/recompute';
import type { Completer } from '../core/llm/types';
import type { PeriodType, PlanItem, ReferenceText, ReferenceTextType, TextPattern } from '../core/domain/types';
import { loadPrompt } from '../core/prompts/loader';
import {
  checkComparison, checkProposal, comparisonInput, proposalInput,
  type ComparisonAnswer, type ProposalAnswer, type TextComparerResult,
} from '../core/references/patterns';
import { excerpt, excludedBecause, ownLinesOnly, patternsAfterSourceChange, referenceVersion, selectReferences, usableReferences } from '../core/references/references';
import { holdOut, summarize, type HoldOutResult, type HoldOutSummary } from '../core/references/evaluate';
import { scrub } from '../core/privacy/scrub';
import type { Repository } from '../storage/repository';
import { activeAdapter, llmStatus, namesToScrub, trackedCompleter, type AdapterOptions } from './llm';

export const REFS_KEY = 'referenceTexts';
export const PATTERNS_KEY = 'textPatterns';
export const EVALUATIONS_KEY = 'textPatternEvaluations';

const newRefId = () => `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const newPatternId = () => `mon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function referenceTexts(repo: Repository): ReferenceText[] {
  const map = (repo.kvGet(REFS_KEY) as Record<string, ReferenceText> | null | undefined) ?? {};
  return Object.values(map).sort((a, b) => (a.approxDate ?? '').localeCompare(b.approxDate ?? '') || a.createdAt.localeCompare(b.createdAt));
}

export function textPatterns(repo: Repository): TextPattern[] {
  const map = (repo.kvGet(PATTERNS_KEY) as Record<string, TextPattern> | null | undefined) ?? {};
  return Object.values(map).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function putRefs(repo: Repository, refs: ReferenceText[]): Promise<void> {
  await repo.kvSet(REFS_KEY, Object.fromEntries(refs.map((r) => [r.id, r])));
}

async function putPatterns(repo: Repository, patterns: TextPattern[]): Promise<void> {
  await repo.kvSet(PATTERNS_KEY, Object.fromEntries(patterns.map((p) => [p.id, p])));
}

/** Evidence from these texts no longer holds: patterns lose it, and are deleted or must be approved again. */
async function sourcesGone(repo: Repository, ids: string[]): Promise<{ deleted: string[]; toReview: string[] }> {
  if (!ids.length) return { deleted: [], toReview: [] };
  const r = patternsAfterSourceChange(textPatterns(repo), ids);
  await putPatterns(repo, r.kept);
  return { deleted: r.deleted, toReview: r.toReview };
}

export type ReferenceDraft = Omit<ReferenceText, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export async function saveReference(repo: Repository, draft: ReferenceDraft, now = new Date()): Promise<ReferenceText> {
  const all = referenceTexts(repo);
  const before = draft.id ? all.find((r) => r.id === draft.id) : undefined;
  const at = now.toISOString();
  const ref: ReferenceText = { ...draft, id: before?.id ?? newRefId(), text: draft.text.trim(), comment: draft.comment?.trim() || null, createdAt: before?.createdAt ?? at, updatedAt: at };
  await putRefs(repo, [...all.filter((r) => r.id !== ref.id), ref]);
  // A changed text, a new label or a text turned off: the patterns built on it must be looked at again.
  if (before && (before.text !== ref.text || before.periodType !== ref.periodType || (before.useInAnalysis && !ref.useInAnalysis))) {
    await sourcesGone(repo, [ref.id]);
  }
  return ref;
}

export async function removeReference(repo: Repository, id: string): Promise<{ deleted: string[]; toReview: string[] }> {
  await putRefs(repo, referenceTexts(repo).filter((r) => r.id !== id));
  return sourcesGone(repo, [id]);
}

export async function setReferenceUse(repo: Repository, id: string, use: boolean): Promise<void> {
  const r = referenceTexts(repo).find((x) => x.id === id);
  if (r) await saveReference(repo, { ...r, useInAnalysis: use });
}

/** Text files as reference texts, one per file. Unlabelled and unused until the person labels them. */
export async function importReferenceFiles(
  repo: Repository,
  files: { name: string; text: string }[],
  opts: { textType: ReferenceTextType; periodType?: PeriodType; ownName?: string | null },
  now = new Date(),
): Promise<{ added: number; droppedLines: number }> {
  let added = 0;
  let droppedLines = 0;
  for (const f of files) {
    // Messages: only the person's own lines, never the whole conversation.
    const own = opts.textType === 'message' ? ownLinesOnly(f.text, opts.ownName) : { text: f.text, dropped: 0 };
    droppedLines += own.dropped;
    if (!own.text.trim()) continue;
    await saveReference(repo, {
      text: own.text,
      approxDate: null,
      periodId: f.name.replace(/\.[^.]+$/, '').slice(0, 40),
      periodType: opts.periodType ?? 'unsure',
      labelSource: 'self_after',
      textType: opts.textType,
      comment: `Importerad från ${f.name}`,
      useInAnalysis: false,
    }, now);
    added++;
  }
  return { added, droppedLines };
}

/** Everything, readable, for the person to keep. Not encrypted: said where it is offered. */
export function exportReferences(repo: Repository, now = new Date()): string {
  return JSON.stringify({ exportedAt: now.toISOString(), referenceTexts: referenceTexts(repo), textPatterns: textPatterns(repo) }, null, 2);
}

// ---- patterns ----

export async function decidePattern(repo: Repository, id: string, status: 'approved' | 'rejected', now = new Date()): Promise<void> {
  await putPatterns(repo, textPatterns(repo).map((p) => (p.id === id ? { ...p, status, decidedAt: now.toISOString() } : p)));
}

export async function removePattern(repo: Repository, id: string): Promise<void> {
  await putPatterns(repo, textPatterns(repo).filter((p) => p.id !== id));
}

function planSigns(repo: Repository): PlanItem[] {
  return repo.plan().filter((p) => p.kind === 'early' || p.kind === 'serious');
}

async function completer(repo: Repository, opts: AdapterOptions): Promise<{ completer: Completer; model: string }> {
  const adapter = await activeAdapter(repo, opts);
  if (!adapter) throw new Error((await llmStatus(repo)).message ?? 'Ingen språkmodell är kopplad.');
  return { completer: trackedCompleter(repo, adapter, opts.now), model: adapter.model };
}

async function propose(c: Completer, refs: ReferenceText[], signs: PlanItem[], names: string[]) {
  const input = proposalInput(refs, signs, names);
  const res = await c.complete(loadPrompt('textmonster'), input.variables);
  return checkProposal(res.json as ProposalAnswer, input);
}

/** Asks the model for patterns in the usable texts. New proposals replace earlier unanswered ones. */
export async function proposePatterns(repo: Repository, opts: AdapterOptions = {}, now = new Date()): Promise<{ added: number; dropped: { description: string; reason: string }[] }> {
  if (!textPatternsEnabled(repo)) throw new Error('Se först vad som skickas, och slå på jämförelsen.');
  const refs = usableReferences(referenceTexts(repo));
  if (refs.length < 2) throw new Error('Det behövs minst två texter som får användas i analysen.');
  const { completer: c, model } = await completer(repo, opts);
  const check = await propose(c, refs, planSigns(repo), namesToScrub(repo));
  const version = referenceVersion(referenceTexts(repo));
  const prompt = loadPrompt('textmonster');
  const fresh: TextPattern[] = check.patterns.map((p) => ({ ...p, id: newPatternId(), createdAt: now.toISOString(), model, promptVersion: prompt.meta.version, referenceVersion: version }));
  await putPatterns(repo, [...textPatterns(repo).filter((p) => p.status !== 'proposed'), ...fresh]);
  return { added: fresh.length, dropped: check.dropped };
}

// ---- the evening comparison ----

export function textPatternsEnabled(repo: Repository): boolean {
  return !!repo.settings().textPatterns?.enabled;
}

export async function setTextPatternsEnabled(repo: Repository, on: boolean, now = new Date()): Promise<void> {
  const before = repo.settings().textPatterns;
  await repo.updateSettings({ textPatterns: { enabled: on, consentAt: on ? (before?.consentAt ?? now.toISOString()) : (before?.consentAt ?? null) } });
}

/** What would be sent, scrubbed, shown before the person turns the comparison on. */
export function outgoingPreview(repo: Repository): {
  /** Sent once when patterns are proposed: every usable text, scrubbed, at most 1 500 characters each. */
  proposal: { id: string; sent: string }[];
  /** Sent each evening with the note: a balanced selection of excerpts. */
  references: { id: string; sent: string }[];
  stableMissing: boolean;
  excludedAkut: string[];
  note: string | null;
} {
  const sel = selectReferences(referenceTexts(repo), textPatterns(repo));
  const names = namesToScrub(repo);
  const last = [...repo.entries()].filter((e) => e.transcript.trim()).sort((a, b) => b.date.localeCompare(a.date))[0];
  return {
    proposal: usableReferences(referenceTexts(repo)).map((r) => ({ id: r.id, sent: scrub(r.text.slice(0, 1500), names).text })),
    references: sel.selected.map((s) => ({ id: s.ref.id, sent: scrub(s.excerpt, names).text })),
    stableMissing: sel.stableMissing,
    excludedAkut: sel.excludedAkut,
    note: last ? scrub(excerpt(last.transcript, [], 600), names).text : null,
  };
}

/**
 * The comparison for one note, or null when it is off, nothing is approved or no model is
 * connected. The caller never runs it for a note that matched the emergency rule.
 */
export async function createTextComparer(repo: Repository, note: string, opts: AdapterOptions = {}): Promise<(() => Promise<TextComparerResult>) | null> {
  if (!textPatternsEnabled(repo)) return null;
  const patterns = textPatterns(repo).filter((p) => p.status === 'approved');
  if (!patterns.length) return null;
  const adapter = await activeAdapter(repo, opts);
  if (!adapter) return null;
  const c = trackedCompleter(repo, adapter, opts.now);
  const refs = referenceTexts(repo);
  return async () => {
    const sel = selectReferences(refs, patterns);
    const input = comparisonInput(note, patterns, sel.selected, sel.stableMissing, namesToScrub(repo));
    const prompt = loadPrompt('textjamforelse');
    const meta = {
      model: adapter.model, promptId: prompt.meta.id, promptVersion: prompt.meta.version, referenceVersion: referenceVersion(refs),
      referenceIds: sel.selected.map((s) => s.ref.id), patternIds: patterns.map((p) => p.id), stableMissing: sel.stableMissing,
    };
    try {
      const res = await c.complete(prompt, input.variables);
      return { ...meta, check: checkComparison(res.json as ComparisonAnswer, input), error: null };
    } catch (e) {
      return { ...meta, check: null, error: (e as Error).message || 'okänt fel' };
    }
  };
}

/**
 * The person says an observation did not fit. It stops counting and the day is computed again;
 * the reference texts and their labels are not touched. The pattern keeps a count.
 */
export async function rejectObservation(repo: Repository, assessmentId: string, patternId: string, quote: string, now = new Date()): Promise<void> {
  const a = repo.assessments().find((x) => x.id === assessmentId);
  const entry = a ? repo.entries().find((e) => e.id === a.entryId) : undefined;
  if (!a || !entry || !a.textPatterns) return;
  const marked = {
    ...a,
    textPatterns: { ...a.textPatterns, observations: a.textPatterns.observations.map((o) => (o.patternId === patternId && o.quote === quote ? { ...o, rejectedAt: now.toISOString() } : o)) },
  };
  const medication: Record<string, boolean> = {};
  for (const e of repo.contextOf('medication_taken')) if (e.date && e.taken != null) medication[e.date] = e.taken;
  const computed = recomputeAssessment(marked, entry, repo.history().filter((h) => h.entry.date < entry.date), {
    plan: repo.plan(), planSettings: repo.planSettings(), garmin: repo.measuredDays(), medication,
  }, now);
  const sentence = a.akut ? a.sentence : computed.level === 'green' ? GREEN_SENTENCE : computed.level === a.level ? a.sentence : templateSentence(computed.signals);
  await repo.saveAssessments([{ ...computed, sentence, recomputed: a.recomputed ?? null }]);
  await putPatterns(repo, textPatterns(repo).map((p) => (p.id === patternId ? { ...p, rejectedObservations: (p.rejectedObservations ?? 0) + 1 } : p)));
}

// ---- retrospective evaluation ----

export interface StoredEvaluation {
  at: string;
  summary: HoldOutSummary;
  results: HoldOutResult[];
  model: string;
}

export function evaluations(repo: Repository): StoredEvaluation[] {
  return (repo.kvGet(EVALUATIONS_KEY) as StoredEvaluation[] | null | undefined) ?? [];
}

/**
 * Holds one whole period out: patterns are proposed again from the other periods only, and
 * every held-out text is compared with them. Counts are against the person's own label, never
 * the traffic light. One model call for the patterns and one per held-out text.
 */
export async function evaluateHoldOut(repo: Repository, periodId: string, opts: AdapterOptions = {}, now = new Date()): Promise<StoredEvaluation> {
  if (!textPatternsEnabled(repo)) throw new Error('Se först vad som skickas, och slå på jämförelsen.');
  const h = holdOut(referenceTexts(repo), periodId);
  if (!h.test.length) throw new Error('Perioden har inga texter som får användas.');
  if (h.train.length < 2) throw new Error('Det behövs minst två texter från andra perioder.');
  const { completer: c, model } = await completer(repo, opts);
  const names = namesToScrub(repo);
  const check = await propose(c, h.train, planSigns(repo), names);
  // Only for the evaluation: the proposals are treated as approved, and never saved.
  const patterns: TextPattern[] = check.patterns.map((p, i) => ({ ...p, id: `eval_${i}`, status: 'approved', createdAt: now.toISOString(), model, promptVersion: null, referenceVersion: 'utvärdering' }));
  const results: HoldOutResult[] = [];
  for (const t of h.test) {
    if (!patterns.length) {
      results.push({ refId: t.id, abstained: true, directions: [] });
      continue;
    }
    const sel = selectReferences(h.train, patterns);
    const input = comparisonInput(t.text, patterns, sel.selected, sel.stableMissing, names);
    try {
      const res = await c.complete(loadPrompt('textjamforelse'), input.variables);
      const cmp = checkComparison(res.json as ComparisonAnswer, input);
      results.push({ refId: t.id, abstained: cmp.abstained, directions: cmp.observations.filter((o) => o.eligible).map((o) => o.direction) });
    } catch (e) {
      results.push({ refId: t.id, abstained: false, directions: [], error: (e as Error).message });
    }
  }
  const stored: StoredEvaluation = { at: now.toISOString(), summary: summarize(h, results, patterns.length), results, model };
  await repo.kvSet(EVALUATIONS_KEY, [stored, ...evaluations(repo)].slice(0, 20));
  return stored;
}

export { excludedBecause };
