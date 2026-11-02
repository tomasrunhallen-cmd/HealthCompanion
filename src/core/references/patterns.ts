// Mina tidigare texter: the model's proposals and its comparison of tonight's note, checked on
// the phone. The model only proposes patterns and observations; every quote, id and reference is
// checked here, and nothing it says decides a level.

import type {
  PatternDirection, Perspective, Phenomenon, PlanItem, ReferenceText, TextObservationInput, TextPattern,
} from '../domain/types';
import { aboutPastOrOthers } from '../context/akut';
import { scrub } from '../privacy/scrub';
import { DIRECTION_TEXT, PERIOD_TEXT, PHENOMENON_TEXT, TEXT_TYPE_TEXT, type SelectedReference } from './references';

const norm = (t: string) => t.toLowerCase().replace(/[“”"'’´`]/g, '').replace(/\s+/g, ' ').trim();
const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

// ---- proposals ----

export interface ProposalAnswer {
  patterns: {
    description: string;
    direction: PatternDirection;
    phenomenon: Phenomenon;
    evidence: { text: string; quote: string }[];
    counterexamples: { text: string; quote: string; note: string }[];
    alternatives: string[];
    plan_sign: string;
  }[];
  notes: string;
}

export interface ProposalInput {
  /** The texts as sent, scrubbed, by their short id ("T1"). */
  texts: Map<string, { ref: ReferenceText; sent: string }>;
  signs: Map<string, PlanItem>;
  variables: Record<string, string>;
}

/** The prompt's variables: every usable text scrubbed, with its labels; the plan's signs. */
export function proposalInput(refs: ReferenceText[], signs: PlanItem[], names: string[], maxChars = 1500): ProposalInput {
  const texts = new Map<string, { ref: ReferenceText; sent: string }>();
  refs.forEach((ref, i) => texts.set(`T${i + 1}`, { ref, sent: scrub(ref.text.slice(0, maxChars), names).text }));
  const signMap = new Map<string, PlanItem>();
  signs.forEach((s, i) => signMap.set(`S${i + 1}`, s));
  const stable = refs.filter((r) => r.periodType === 'stable').length;
  return {
    texts,
    signs: signMap,
    variables: {
      tecken: [...signMap].map(([id, s]) => `${id}. ${scrub(s.text, names).text}`).join('\n') || '(inga tecken)',
      om_materialet: `${refs.length} texter från ${new Set(refs.map((r) => r.periodId)).size} perioder. ${stable ? `${stable} från stabila perioder.` : 'Inga texter från stabila perioder: motexempel saknas.'} Märkningen är personens egen och kan vara fel.`,
      texter: [...texts].map(([id, { ref, sent }]) =>
        `[${id}] period ${ref.periodId}, märkt ${PERIOD_TEXT[ref.periodType].toLowerCase()}, ${TEXT_TYPE_TEXT[ref.textType].toLowerCase()}${ref.approxDate ? `, ca ${ref.approxDate}` : ''}\n${sent}`).join('\n\n'),
    },
  };
}

export interface ProposalCheck {
  patterns: Omit<TextPattern, 'id' | 'createdAt' | 'model' | 'promptVersion' | 'referenceVersion'>[];
  dropped: { description: string; reason: string }[];
}

/**
 * The model's proposals, checked: every quote must stand word for word in the text it names,
 * and a pattern needs evidence from at least two different texts. Unknown text or sign ids are
 * dropped. Everything is a proposal until the person approves it.
 */
export function checkProposal(answer: ProposalAnswer, input: ProposalInput): ProposalCheck {
  const patterns: ProposalCheck['patterns'] = [];
  const dropped: ProposalCheck['dropped'] = [];
  const ok = (e: { text: string; quote: string }) => {
    const t = input.texts.get(e.text);
    return !!t && wordCount(e.quote) >= 2 && norm(t.sent).includes(norm(e.quote));
  };
  for (const p of answer.patterns) {
    const evidence = p.evidence.filter(ok).map((e) => ({ refId: input.texts.get(e.text)!.ref.id, quote: e.quote.trim() }));
    const sources = new Set(evidence.map((e) => e.refId));
    if (sources.size < 2) {
      dropped.push({ description: p.description, reason: evidence.length < p.evidence.length ? 'Citaten fanns inte ordagrant i texterna' : 'Belägg från färre än två texter' });
      continue;
    }
    patterns.push({
      description: p.description.trim(),
      direction: p.direction,
      phenomenon: p.phenomenon,
      evidence,
      counterExamples: p.counterexamples.filter(ok).map((e) => ({ refId: input.texts.get(e.text)!.ref.id, quote: e.quote.trim(), note: e.note.trim() || null })),
      alternatives: p.alternatives.map((a) => a.trim()).filter(Boolean),
      planSignId: input.signs.get(p.plan_sign.trim())?.id ?? null,
      status: 'proposed',
      decidedAt: null,
    });
  }
  return { patterns, dropped };
}

// ---- tonight's comparison ----

export interface ComparisonAnswer {
  abstain: boolean;
  abstain_reason: string;
  observations: { pattern: string; quote: string; perspective: Perspective; note: string; references: string[] }[];
  differences: string[];
  uncertainties: string[];
}

export interface ComparisonInput {
  patterns: Map<string, TextPattern>;
  references: Map<string, SelectedReference>;
  /** Tonight's note as sent, scrubbed. */
  note: string;
  variables: Record<string, string>;
}

export function comparisonInput(note: string, patterns: TextPattern[], selected: SelectedReference[], stableMissing: boolean, names: string[]): ComparisonInput {
  const pmap = new Map<string, TextPattern>();
  patterns.filter((p) => p.status === 'approved').forEach((p, i) => pmap.set(`M${i + 1}`, p));
  const rmap = new Map<string, SelectedReference>();
  selected.forEach((s, i) => rmap.set(`R${i + 1}`, s));
  const sent = scrub(note, names).text;
  return {
    patterns: pmap,
    references: rmap,
    note: sent,
    variables: {
      monster: [...pmap].map(([id, p]) => `${id}. ${scrub(p.description, names).text} (riktning ${DIRECTION_TEXT[p.direction]}, ${PHENOMENON_TEXT[p.phenomenon]})`).join('\n'),
      referenser: [...rmap].map(([id, s]) =>
        `[${id}] märkt ${PERIOD_TEXT[s.ref.periodType].toLowerCase()}, period ${s.ref.periodId}, ${TEXT_TYPE_TEXT[s.ref.textType].toLowerCase()}${s.ref.approxDate ? `, ca ${s.ref.approxDate}` : ''}\n${scrub(s.excerpt, names).text}`).join('\n\n') || '(inga)',
      om_urvalet: stableMissing
        ? 'Inga utdrag från stabila perioder finns. Jämförelsen saknar motvikt och är därför osäker.'
        : 'Urvalet har utdrag från stabila perioder och från andra perioder, högst två per period.',
      anteckning: sent,
    },
  };
}

export interface CheckedObservation extends TextObservationInput {
  perspective: Perspective;
  /** Passed every check on the phone and may count, if the rules let it. */
  eligible: boolean;
  reason: string | null;
}

export interface ComparisonCheck {
  abstained: boolean;
  abstainReason: string | null;
  observations: CheckedObservation[];
  differences: string[];
  uncertainties: string[];
}

const PERSPECTIVE_REASON: Record<Exclude<Perspective, 'self_now'>, string> = {
  history: 'Handlar om något som hänt förut',
  other_person: 'Handlar om någon annan',
  quote_or_hypothetical: 'Ett citat eller ett tänkt resonemang',
  humor_or_irony: 'Humor eller ironi',
  text_context: 'Kan bero på texttyp, mottagare eller ämne',
};

/**
 * The comparison, checked on the phone. An observation may count only with an approved pattern
 * id, a quote that stands word for word in tonight's note, the model's own perspective being
 * the person now, and no sign in the quote's sentence of the past or someone else. Unknown ids,
 * invented quotes and an abstention give nothing.
 */
export function checkComparison(answer: ComparisonAnswer, input: ComparisonInput): ComparisonCheck {
  if (answer.abstain) {
    return { abstained: true, abstainReason: answer.abstain_reason.trim() || null, observations: [], differences: answer.differences, uncertainties: answer.uncertainties };
  }
  const note = norm(input.note);
  const observations: CheckedObservation[] = [];
  for (const o of answer.observations) {
    const p = input.patterns.get(o.pattern.trim());
    const base = {
      patternId: p?.id ?? `okänt:${o.pattern}`,
      quote: o.quote.trim(),
      direction: p?.direction ?? 'unclear',
      phenomenon: p?.phenomenon ?? 'other',
      planSignId: p?.planSignId ?? null,
      description: p?.description ?? '(okänt mönster)',
      referenceIds: o.references.map((r) => input.references.get(r.trim())?.ref.id).filter((x): x is string => !!x),
      note: o.note.trim(),
      perspective: o.perspective,
    };
    let reason: string | null = null;
    if (!p) reason = 'Okänt mönster-id';
    else if (wordCount(o.quote) < 2 || !note.includes(norm(o.quote))) reason = 'Citatet finns inte ordagrant i anteckningen';
    else if (o.perspective !== 'self_now') reason = PERSPECTIVE_REASON[o.perspective];
    else if (aboutPastOrOthers(sentenceAround(input.note, o.quote))) reason = 'Meningen handlar om något förr, någon annan eller ett ämne';
    observations.push({ ...base, eligible: !reason, reason });
  }
  return { abstained: false, abstainReason: null, observations, differences: answer.differences, uncertainties: answer.uncertainties };
}

/** The sentence of the note that holds the quote. */
function sentenceAround(note: string, quote: string): string {
  const sentences = note.split(/(?<=[.!?…\n])\s*/);
  return sentences.find((s) => norm(s).includes(norm(quote))) ?? quote;
}

/** What the service hands the assessment: the checked comparison and what it was made from. */
export interface TextComparerResult {
  check: ComparisonCheck | null;
  /** The call failed or its answer was invalid: nothing counts. */
  error: string | null;
  model: string | null;
  promptId: string;
  promptVersion: string;
  referenceVersion: string;
  referenceIds: string[];
  patternIds: string[];
  stableMissing: boolean;
}
