// The emergency rule. Matched in code, on the phone, before any model call and
// independently of it, also without network. The word list (context/akut.md) and the
// user's own emergency phrases are never sent to a model.

import { CONTEXT_SOURCES } from '../prompts/bundle.generated';
import { parseFrontmatter } from '../prompts/loader';
import type { PlanItem } from '../domain/types';
import { tokenize, wordsMatch } from '../analysis/wordmatch';

const NEGATIONS = new Set(['inte', 'aldrig', 'ingen', 'inget', 'inga', 'ej']);
/** Words allowed between the words of a phrase ("vill verkligen inte leva"). A negation there makes the hit mild. */
const MAX_GAP = 2;

export function parseAkut(source: string): string[] {
  const { body } = parseFrontmatter(source);
  const out: string[] = [];
  let inList = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) {
      inList = /fraser/i.test(line);
      continue;
    }
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (inList && m) out.push(m[1]);
  }
  return out;
}

let cached: string[] | null = null;
export function akutPhrases(): string[] {
  if (!cached) {
    const src = CONTEXT_SOURCES['context/akut.md'];
    if (!src) throw new Error('context/akut.md saknas');
    cached = parseAkut(src);
  }
  return cached;
}

/** Letters an inflection may add after the shared stem ("skada" / "skadade"). */
const MAX_ENDING = 3;

function tokenEq(a: string, b: string): boolean {
  // Short words must be equal; longer ones may be inflections ("skadar" / "skada").
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || !wordsMatch(a, b)) return false;
  // A longer tail makes another word: "själv" is not "självmord", "skadeglad" is not "skada".
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return Math.max(a.length, b.length) - p <= MAX_ENDING;
}

/** Words before a phrase that can negate it, within the same clause ("har aldrig haft självmordstankar"). */
const NEGATION_LOOKBACK = 2;

/**
 * Where the phrase's words occur in order, with at most MAX_GAP words between. `negated`
 * is true when a negation that is not part of the phrase stands between its words or just
 * before it ("vill inte dö", "tänker inte göra mig illa"). A plain occurrence wins over a
 * negated one.
 */
function phraseIn(words: string[], phrase: string[]): { found: boolean; negated: boolean } {
  if (!phrase.length) return { found: false, negated: false };
  const own = (w: string) => phrase.includes(w);
  let negatedHit = false;
  for (let start = 0; start < words.length; start++) {
    if (!tokenEq(words[start], phrase[0])) continue;
    let pos = start;
    let ok = true;
    let negated = words.slice(Math.max(0, start - NEGATION_LOOKBACK), start).some((w) => NEGATIONS.has(w) && !own(w));
    for (let k = 1; k < phrase.length && ok; k++) {
      ok = false;
      for (let gap = 0; gap <= MAX_GAP && pos + 1 + gap < words.length; gap++) {
        const w = words[pos + 1 + gap];
        if (tokenEq(w, phrase[k])) {
          pos = pos + 1 + gap;
          ok = true;
          break;
        }
        if (NEGATIONS.has(w) && !own(w)) negated = true;
      }
    }
    if (ok && !negated) return { found: true, negated: false };
    if (ok) negatedHit = true;
  }
  return { found: negatedHit, negated: negatedHit };
}

/** Clauses: a negation in one clause does not touch a phrase in the next ("mår inte bra, vill dö"). */
function clauses(note: string): string[][] {
  return note
    .split(/[.!?…,;:\n]+/)
    .map((c) => tokenize(c))
    .filter((c) => c.length > 0);
}

export type AkutLevel = 'full' | 'mild';

export interface AkutResult {
  /** full: crisis card, red day, nothing sent. mild: gentler card, level unchanged, nothing sent to the model. */
  level: AkutLevel | null;
  phrases: string[];
}

export function akutCheck(note: string, userPhrases: string[] = []): AkutResult {
  const parts = clauses(note);
  if (!parts.length) return { level: null, phrases: [] };
  const full: string[] = [];
  const mild: string[] = [];
  for (const p of [...akutPhrases(), ...userPhrases].filter((x) => x.trim())) {
    const tokens = tokenize(p);
    let hit: { found: boolean; negated: boolean } = { found: false, negated: false };
    for (const words of parts) {
      const h = phraseIn(words, tokens);
      if (h.found && !h.negated) { hit = h; break; }
      if (h.found) hit = h;
    }
    if (hit.found) (hit.negated ? mild : full).push(p);
  }
  if (full.length) return { level: 'full', phrases: full };
  if (mild.length) return { level: 'mild', phrases: mild };
  return { level: null, phrases: [] };
}

/** The phrases that occur in the note without a negation. Empty when none. */
export function akutMatches(note: string, userPhrases: string[] = []): string[] {
  const r = akutCheck(note, userPhrases);
  return r.level === 'full' ? r.phrases : [];
}

/** A full match: the crisis card, a red day, nothing fetched or sent. */
export function isAkut(note: string, userPhrases: string[] = []): boolean {
  return akutCheck(note, userPhrases).level === 'full';
}

export function akutLevel(note: string, userPhrases: string[] = []): AkutLevel | null {
  return akutCheck(note, userPhrases).level;
}

export interface CrisisNumber {
  number: string;
  label: string;
}

export const CRISIS_NUMBERS: CrisisNumber[] = [
  { number: '112', label: 'Vid fara för liv' },
  { number: '1177', label: 'Sjukvårdsrådgivning' },
  { number: '90101', label: 'Självmordslinjen, samtal och chatt' },
];

/** What the crisis card shows: the plan's own steps at red, then the numbers. */
export function crisisInfo(plan: PlanItem[]): { steps: string[]; numbers: CrisisNumber[] } {
  return {
    steps: plan.filter((p) => p.kind === 'action_red').sort((a, b) => a.order - b.order).map((p) => p.text),
    numbers: CRISIS_NUMBERS,
  };
}

/** Crisis plan lines that match the list, negated or not, stay on the phone: they are taken out before a model sees the plan. */
export function splitAkutLines(text: string, userPhrases: string[] = []): { kept: string; akut: string[] } {
  const kept: string[] = [];
  const akut: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() && akutLevel(line, userPhrases) != null) akut.push(line.replace(/^\s*(?:[-–—•*·]|\d+[.)])\s+/, '').trim());
    else kept.push(line);
  }
  return { kept: kept.join('\n'), akut };
}
