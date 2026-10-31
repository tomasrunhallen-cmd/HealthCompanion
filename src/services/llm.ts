// Connects the stored language model settings to the adapter, and runs the test cases
// behind "Testa modellen". Nothing is sent unless the user has configured a provider
// and confirmed where the text goes (consent is stored per provider and address).

import { createCompleter } from '../adapter/complete';
import { createAdapter, type FetchLike } from '../adapter/http';
import type { ProviderId } from '../adapter/providers';
import type { Completer, LlmAdapter } from '../adapter/types';
import { assessEntry, wordMatcher, type SignMatcher } from '../analysis/assess';
import { eveningDateKey } from '../analysis/dates';
import { createLlmMatcher } from '../analysis/llmMatcher';
import { loadTestSuite } from '../analysis/testcases';
import type { Level, PlanItemKind } from '../domain/types';
import { hasConsent, type LlmConfig } from '../llm/config';
import type { DraftKind, DraftRow } from '../plan/parsePlan';
import { loadPrompt } from '../prompts/loader';
import { namesFromPlanText, restorePlaceholders } from '../privacy/scrub';
import { getSecret } from '../platform/secrets';
import type { Repository } from '../storage/repository';

export const LLM_KEY_NAME = 'dagsljus.llmkey.v1';

export interface AdapterOptions {
  fetch?: FetchLike;
  browser?: boolean;
  /** Clock for dating token use; the check-in passes its own time. */
  now?: () => Date;
}

/** Names removed before text is sent: the user's own list plus names found in the plan. */
export function namesToScrub(repo: Repository): string[] {
  const fromPlan = namesFromPlanText(repo.plan().map((p) => p.text).join('. '));
  return Array.from(new Set([...repo.settings().scrubNames, ...fromPlan]));
}

export function buildAdapter(
  draft: { provider: ProviderId; model: string; baseUrl: string },
  apiKey: string | null,
  opts: AdapterOptions = {},
): LlmAdapter {
  return createAdapter({
    provider: draft.provider,
    model: draft.model.trim(),
    baseUrl: draft.baseUrl,
    apiKey: apiKey?.trim() || null,
    fetch: opts.fetch,
    browser: opts.browser,
  });
}

/** Completer that records token use and the last sent text in the repository. */
export function trackedCompleter(repo: Repository, adapter: LlmAdapter, now: () => Date = () => new Date()): Completer {
  return createCompleter(adapter, {
    onSent: (req) => void repo.setLastSent(req),
    onUsage: (u) => void repo.recordUsage(eveningDateKey(now()), u),
  });
}

/** True when the settings are complete enough to call a model. */
export function llmReady(c: LlmConfig): boolean {
  return !!c.provider && !!c.model.trim() && hasConsent(c) && (c.provider !== 'openai-compatible' || !!c.baseUrl.trim());
}

/** The configured model, or null when the app should use word matching. */
export async function activeAdapter(repo: Repository, opts: AdapterOptions = {}): Promise<LlmAdapter | null> {
  const c = repo.llmConfig();
  if (!llmReady(c) || !c.provider) return null;
  const key = await getSecret(LLM_KEY_NAME);
  if (c.provider !== 'openai-compatible' && !key) return null;
  return buildAdapter({ provider: c.provider, model: c.model, baseUrl: c.baseUrl }, key, opts);
}

export async function currentMatcher(repo: Repository, opts: AdapterOptions = {}): Promise<SignMatcher> {
  const adapter = await activeAdapter(repo, opts);
  if (!adapter) return wordMatcher;
  return createLlmMatcher({ completer: trackedCompleter(repo, adapter, opts.now), model: adapter.model, names: () => namesToScrub(repo) });
}

// ---- "Testa modellen" ----

export interface CaseResult {
  id: string;
  name: string;
  expected: Level;
  got: Level | null;
  ok: boolean;
  /** Why the case failed, in Swedish, when the model call itself failed. */
  error: string | null;
}

export interface ModelTestReport {
  passed: number;
  total: number;
  cases: CaseResult[];
  promptVersion: string;
}

/**
 * Runs the four test cases from prompts/testfall.md through the full path: scrub,
 * prompt, model, schema check, scoring in code. A case passes when the model answered
 * with valid JSON (no fallback) and the level is the expected one.
 */
export async function runModelTest(
  completer: Completer,
  model: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ModelTestReport> {
  const suite = loadTestSuite();
  const inner = createLlmMatcher({ completer, model, names: () => [] });
  const cases: CaseResult[] = [];
  for (const c of suite.cases) {
    let error: string | null = null;
    const matcher: SignMatcher = {
      async match(note, signs, settings) {
        try {
          return await inner.match(note, signs, settings);
        } catch (e) {
          error = (e as Error).message || 'Okänt fel';
          throw e;
        }
      },
    };
    const a = await assessEntry({ entry: c.entry, plan: suite.plan, planSettings: suite.planSettings, history: c.history, matcher });
    const answered = a.method === 'llm';
    cases.push({
      id: c.id,
      name: c.name,
      expected: c.expected,
      got: answered ? a.level : null,
      ok: answered && a.level === c.expected,
      error: answered ? null : error ?? 'Modellen svarade inte enligt schemat.',
    });
    onProgress?.(cases.length, suite.cases.length);
    // A wrong key or address fails every case the same way; stop early and save tokens.
    if (cases.length === 1 && error && /nyckel|adress|kontakt|hittade inte/i.test(error)) break;
  }
  return {
    passed: cases.filter((c) => c.ok).length,
    total: suite.cases.length,
    cases,
    promptVersion: loadPrompt('analys').meta.version,
  };
}

// ---- crisis plan import with a model ----

const IMPORT_KIND: Record<string, DraftKind> = {
  tidigt: 'early',
  allvarligt: 'serious',
  'atgard-gult': 'action_yellow',
  'atgard-rott': 'action_red',
  anhorig: 'relatives',
  normallage: 'normal',
};

export interface ImportedRow extends DraftRow {
  /** False when the row's words are not found in the pasted plan; shown as a warning. */
  inOriginal: boolean;
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-zåäöéü0-9]+/g, ' ').trim();
}

/**
 * Sends the scrubbed plan to the model with prompts/krisplan-import.md and turns the
 * answer into draft rows. Placeholders are put back on the phone. Every row starts
 * unapproved; nothing is saved until the user approves it.
 */
export async function structurePlanWithModel(
  completer: Completer,
  scrubbedText: string,
  map: Record<string, string>,
  originalText: string,
): Promise<ImportedRow[]> {
  const res = await completer.complete(loadPrompt('krisplan-import'), { krisplan: scrubbedText });
  const answer = res.json as { rows: { kind: string; text: string }[] };
  const original = squash(originalText);
  return answer.rows
    .map((r, i): ImportedRow => {
      const text = restorePlaceholders(r.text, map).trim();
      return {
        key: `m${i}`,
        text,
        kind: IMPORT_KIND[r.kind] ?? 'unsorted',
        approved: false,
        inOriginal: original.includes(squash(text)),
      };
    })
    .filter((r) => r.text.length > 0);
}

export function isPlanKind(k: DraftKind): k is PlanItemKind {
  return k !== 'normal' && k !== 'unsorted';
}
