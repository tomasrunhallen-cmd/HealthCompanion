// Mina tidigare texter: the reference material itself. What may be used, what is kept on the
// phone, a fair selection for a comparison, and what happens to patterns when their sources go.
// Pure code; nothing here calls a model.

import type { PeriodType, ReferenceText, ReferenceTextType, LabelSource, TextPattern, PatternDirection, Phenomenon, Perspective } from '../domain/types';
import { akutCheck } from '../context/akut';

export const PERIOD_TEXT: Record<PeriodType, string> = {
  stable: 'Stabil',
  up: 'Uppvarvad eller mani',
  down: 'Nedstämd eller depression',
  mixed: 'Blandad',
  unsure: 'Osäker',
};
export const LABEL_SOURCE_TEXT: Record<LabelSource, string> = {
  self_after: 'Min egen bedömning i efterhand',
  with_care: 'Bedömt tillsammans med vården',
};
export const TEXT_TYPE_TEXT: Record<ReferenceTextType, string> = {
  diary: 'Dagbok',
  message: 'Meddelande',
  work: 'Arbetsrelaterad text',
  other: 'Annat',
};
export const DIRECTION_TEXT: Record<PatternDirection, string> = {
  up: 'uppåt',
  down: 'nedåt',
  mixed: 'blandad',
  unclear: 'oklar',
};
export const PHENOMENON_TEXT: Record<Phenomenon, string> = {
  sleep: 'sömn',
  activity: 'aktivitet och åtaganden',
  mood: 'stämning',
  speech: 'tempo och meningsbyggnad',
  social: 'kontakt med andra',
  self_worth: 'självvärdering',
  thinking: 'tankar och ämnesväxlingar',
  other: 'annat',
};
export const PERSPECTIVE_TEXT: Record<Perspective, string> = {
  self_now: 'om dig själv nu',
  history: 'om något som hänt förut',
  other_person: 'om någon annan',
  quote_or_hypothetical: 'ett citat eller ett tänkt resonemang',
  humor_or_irony: 'humor eller ironi',
  text_context: 'kan bero på texttyp, mottagare eller ämne',
};

/** Why a reference text is not sent to a model. Null: it may be used. */
export function excludedBecause(ref: ReferenceText): 'off' | 'akut' | 'empty' | null {
  if (!ref.useInAnalysis) return 'off';
  if (!ref.text.trim()) return 'empty';
  // The promise that notes matching the emergency rule never reach a model holds for old texts too.
  if (akutCheck(ref.text).level) return 'akut';
  return null;
}

export const EXCLUDED_TEXT: Record<'off' | 'akut' | 'empty', string> = {
  off: 'Används inte i analysen',
  akut: 'Skickas inte: innehåller formuleringar som akutregeln reagerar på. Sådan text skickas aldrig till en modell, inte heller gammal',
  empty: 'Tom',
};

export function usableReferences(refs: ReferenceText[]): ReferenceText[] {
  return refs.filter((r) => !excludedBecause(r));
}

/** A short fingerprint of the material in use, saved with every pattern and comparison. */
export function referenceVersion(refs: ReferenceText[]): string {
  const src = usableReferences(refs).map((r) => `${r.id}:${r.updatedAt}`).sort().join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `r${h.toString(16).padStart(8, '0')}`;
}

/**
 * Only the person's own lines from a message export: lines like "Tomas: hej" or
 * "[12:03] Tomas: hej" whose name is the person's. Other people's lines never come in.
 * A text without such lines is returned as it is.
 */
export function ownLinesOnly(text: string, ownName: string | null | undefined): { text: string; kept: number; dropped: number } {
  const name = ownName?.trim().toLowerCase();
  const line = /^\s*(?:\[[^\]]{1,40}\]\s*|\d{1,4}[-./]\d{1,2}[-./]\d{1,4},?\s*\d{1,2}[:.]\d{2}(?::\d{2})?\s*[-–]?\s*)?([^:\n]{1,40}):\s?(.*)$/;
  const lines = text.split(/\r?\n/);
  const speakers = lines.map((l) => line.exec(l));
  if (!name || speakers.filter(Boolean).length < 2) return { text, kept: lines.length, dropped: 0 };
  const own: string[] = [];
  let dropped = 0;
  for (const m of speakers) {
    if (!m) continue;
    if (m[1].trim().toLowerCase() === name) own.push(m[2]);
    else dropped++;
  }
  return { text: own.join('\n'), kept: own.length, dropped };
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/** A part of a reference text, at most `max` characters, around the given quotes when there are any. */
export function excerpt(text: string, quotes: string[] = [], max = 500): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const at = quotes.map((q) => norm(clean).indexOf(norm(q))).find((i) => i >= 0);
  const start = at != null && at >= 0 ? Math.max(0, at - Math.floor(max / 3)) : 0;
  const cut = clean.slice(start, start + max);
  return `${start > 0 ? '… ' : ''}${cut}${start + max < clean.length ? ' …' : ''}`;
}

export interface SelectedReference {
  ref: ReferenceText;
  excerpt: string;
}

export interface Selection {
  selected: SelectedReference[];
  /** No stable-period text could be included. */
  stableMissing: boolean;
  /** Texts kept on the phone because of the emergency rule. */
  excludedAkut: string[];
}

/**
 * A balanced choice of references for a comparison: texts that back or speak against the
 * approved patterns, and stable texts, at most `perPeriod` from any one period so that no period
 * dominates. Not the texts most like today's note. Deterministic.
 */
export function selectReferences(refs: ReferenceText[], patterns: TextPattern[], opts: { max?: number; perPeriod?: number; maxChars?: number } = {}): Selection {
  const max = opts.max ?? 8;
  const perPeriod = opts.perPeriod ?? 2;
  const usable = usableReferences(refs);
  const excludedAkut = refs.filter((r) => excludedBecause(r) === 'akut').map((r) => r.id);
  const approved = patterns.filter((p) => p.status === 'approved');
  const quotesFor = (id: string) => approved.flatMap((p) => [...p.evidence, ...p.counterExamples]).filter((e) => e.refId === id).map((e) => e.quote);
  const cited = new Set(approved.flatMap((p) => [...p.evidence, ...p.counterExamples].map((e) => e.refId)));
  const counter = new Set(approved.flatMap((p) => p.counterExamples.map((e) => e.refId)));
  // Order: counterexamples, stable texts, other cited texts, the rest; oldest first within each.
  const rank = (r: ReferenceText) => (counter.has(r.id) ? 0 : r.periodType === 'stable' ? 1 : cited.has(r.id) ? 2 : 3);
  const queue = [...usable].sort((a, b) => rank(a) - rank(b) || (a.approxDate ?? '').localeCompare(b.approxDate ?? '') || a.id.localeCompare(b.id));
  const perCount = new Map<string, number>();
  const chosen: ReferenceText[] = [];
  // Two rounds: first spread over periods and kinds, then fill.
  const kinds = new Set<string>();
  for (const pass of [0, 1]) {
    for (const r of queue) {
      if (chosen.length >= max) break;
      if (chosen.includes(r)) continue;
      if ((perCount.get(r.periodId) ?? 0) >= perPeriod) continue;
      if (pass === 0 && kinds.has(`${r.periodId}`)) continue;
      chosen.push(r);
      kinds.add(r.periodId);
      perCount.set(r.periodId, (perCount.get(r.periodId) ?? 0) + 1);
    }
  }
  return {
    selected: chosen.map((ref) => ({ ref, excerpt: excerpt(ref.text, quotesFor(ref.id), opts.maxChars ?? 500) })),
    stableMissing: !chosen.some((r) => r.periodType === 'stable'),
    excludedAkut,
  };
}

/**
 * Patterns after reference texts were removed or turned off: evidence from them goes. A pattern
 * left without evidence is deleted; one with evidence left from other texts must be approved
 * again before it is used (needs_review).
 */
export function patternsAfterSourceChange(patterns: TextPattern[], goneIds: string[]): { kept: TextPattern[]; deleted: string[]; toReview: string[] } {
  const gone = new Set(goneIds);
  const kept: TextPattern[] = [];
  const deleted: string[] = [];
  const toReview: string[] = [];
  for (const p of patterns) {
    if (!p.evidence.some((e) => gone.has(e.refId)) && !p.counterExamples.some((e) => gone.has(e.refId))) {
      kept.push(p);
      continue;
    }
    const evidence = p.evidence.filter((e) => !gone.has(e.refId));
    if (!evidence.length) {
      deleted.push(p.id);
      continue;
    }
    const next: TextPattern = {
      ...p,
      evidence,
      counterExamples: p.counterExamples.filter((e) => !gone.has(e.refId)),
      status: p.status === 'rejected' ? 'rejected' : 'needs_review',
    };
    kept.push(next);
    if (next.status === 'needs_review') toReview.push(p.id);
  }
  return { kept, deleted, toReview };
}

/** The periods that back a pattern, from its evidence. */
export function periodsOf(p: TextPattern, refs: ReferenceText[]): { periodId: string; periodType: PeriodType }[] {
  const byId = new Map(refs.map((r) => [r.id, r]));
  const out = new Map<string, PeriodType>();
  for (const e of p.evidence) {
    const r = byId.get(e.refId);
    if (r) out.set(r.periodId, r.periodType);
  }
  return [...out].map(([periodId, periodType]) => ({ periodId, periodType }));
}

/** How many usable texts come from stable periods. */
export function stableCount(refs: ReferenceText[]): number {
  return usableReferences(refs).filter((r) => r.periodType === 'stable').length;
}
