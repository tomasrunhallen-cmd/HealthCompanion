// Retrospective evaluation of Mina tidigare texter: one whole period is held out, patterns are
// proposed again from the rest, and each held-out text is compared with them. The same text or
// a near copy is never both reference and test. The app's own traffic light is not the answer
// key: only the person's own label of the held-out period is, and it may be wrong too.

import type { PatternDirection, PeriodType, ReferenceText } from '../domain/types';
import { usableReferences } from './references';

/** Eight words in a row shared by two texts make them near copies. */
const SHINGLE = 8;

function shingles(text: string): Set<string> {
  const w = text.toLowerCase().replace(/[^a-zåäöéü0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '));
  if (w.length && w.length < SHINGLE) out.add(w.join(' '));
  return out;
}

export function nearCopies(a: string, b: string): boolean {
  const x = shingles(a);
  for (const s of shingles(b)) if (x.has(s)) return true;
  return false;
}

export interface HoldOut {
  periodId: string;
  periodType: PeriodType;
  test: ReferenceText[];
  train: ReferenceText[];
  /** Texts from other periods left out because they share passages with the test texts. */
  droppedAsCopies: string[];
}

export function holdOut(refs: ReferenceText[], periodId: string): HoldOut {
  const usable = usableReferences(refs);
  const test = usable.filter((r) => r.periodId === periodId);
  const rest = usable.filter((r) => r.periodId !== periodId);
  const droppedAsCopies = rest.filter((r) => test.some((t) => nearCopies(r.text, t.text))).map((r) => r.id);
  return {
    periodId,
    periodType: test[0]?.periodType ?? 'unsure',
    test,
    train: rest.filter((r) => !droppedAsCopies.includes(r.id)),
    droppedAsCopies,
  };
}

/** One held-out text and what the comparison gave. */
export interface HoldOutResult {
  refId: string;
  abstained: boolean;
  /** Directions of observations that passed every check. */
  directions: PatternDirection[];
  error?: string | null;
}

export interface HoldOutSummary {
  periodId: string;
  periodType: PeriodType;
  texts: number;
  abstained: number;
  errors: number;
  /** Stable period: texts with an observation that would count. */
  falseSignals: number | null;
  /** Up, down or mixed period: texts with no observation in the period's direction. */
  missed: number | null;
  /** Observations pointing the other way than the period's label. */
  otherDirection: number;
  patternsFromRest: number;
}

/** Counts against the person's own label of the held-out period, never against the traffic light. */
export function summarize(h: HoldOut, results: HoldOutResult[], patternsFromRest: number): HoldOutSummary {
  const answered = results.filter((r) => !r.abstained && !r.error);
  const wanted: PatternDirection[] = h.periodType === 'up' ? ['up', 'mixed'] : h.periodType === 'down' ? ['down', 'mixed'] : h.periodType === 'mixed' ? ['up', 'down', 'mixed'] : [];
  return {
    periodId: h.periodId,
    periodType: h.periodType,
    texts: results.length,
    abstained: results.filter((r) => r.abstained).length,
    errors: results.filter((r) => r.error).length,
    falseSignals: h.periodType === 'stable' ? answered.filter((r) => r.directions.length > 0).length : null,
    missed: wanted.length ? answered.filter((r) => !r.directions.some((d) => wanted.includes(d))).length : null,
    otherDirection: h.periodType === 'up' ? answered.filter((r) => r.directions.includes('down')).length
      : h.periodType === 'down' ? answered.filter((r) => r.directions.includes('up')).length : 0,
    patternsFromRest,
  };
}
