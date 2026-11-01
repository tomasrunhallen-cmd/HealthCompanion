// The emergency rule. Matched in code, on the phone, before any model call and
// independently of it, also without network. The word list (context/akut.md) and the
// user's own emergency phrases are never sent to a model.

import { CONTEXT_SOURCES } from '../prompts/bundle.generated';
import { parseFrontmatter } from '../prompts/loader';
import type { PlanItem } from '../domain/types';
import { tokenize, wordsMatch } from '../analysis/wordmatch';
import { actionsFor, ladderOf } from '../plan/guidance';

const NEGATIONS = new Set(['inte', 'aldrig', 'ingen', 'inget', 'inga', 'ej']);
/** Words allowed between the words of a phrase ("vill verkligen inte leva"). A negation there makes the hit mild. */
const MAX_GAP = 2;

export interface AkutLists {
  /** Phrases matched word by word, tolerating inflections and up to two words between. */
  phrases: string[];
  /** Core words that match as the start of a word, however long the rest: "självmord" in "självmordsförsök". */
  cores: string[];
  /** Known false hits. Their words may only match a phrase word that is spelled the same, never as an inflection. */
  exceptions: string[];
}

const SECTION: Record<string, keyof AkutLists> = { fraser: 'phrases', 'kärnord': 'cores', undantag: 'exceptions' };

export function parseAkutLists(source: string): AkutLists {
  const { body } = parseFrontmatter(source);
  const out: AkutLists = { phrases: [], cores: [], exceptions: [] };
  let into: keyof AkutLists | null = null;
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      into = SECTION[h[1].toLowerCase()] ?? null;
      continue;
    }
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (into && m) out[into].push(m[1]);
  }
  return out;
}

/** The phrases only, for callers that list them. */
export function parseAkut(source: string): string[] {
  return parseAkutLists(source).phrases;
}

let cached: AkutLists | null = null;
export function akutLists(): AkutLists {
  if (!cached) {
    const src = CONTEXT_SOURCES['context/akut.md'];
    if (!src) throw new Error('context/akut.md saknas');
    cached = parseAkutLists(src);
  }
  return cached;
}

/** Phrases and core words, everything that can give a match. */
export function akutPhrases(): string[] {
  const l = akutLists();
  return [...l.phrases, ...l.cores];
}

function tokenEq(word: string, token: string, guarded: boolean): boolean {
  if (word === token) return true;
  // A word inside a known false hit ("skärper mig") is never taken as an inflection.
  if (guarded) return false;
  // Short words must be equal; longer ones may be inflections ("skadar" / "skada").
  return Math.min(word.length, token.length) >= 4 && wordsMatch(word, token);
}

/** Marks the words of a clause that are part of a known false hit. */
function guardMask(words: string[], exceptions: string[][]): boolean[] {
  const mask = words.map(() => false);
  for (const ex of exceptions) {
    if (!ex.length) continue;
    for (let i = 0; i + ex.length <= words.length; i++) {
      if (ex.every((t, k) => words[i + k] === t)) for (let k = 0; k < ex.length; k++) mask[i + k] = true;
    }
  }
  return mask;
}

/** Words before a phrase that can negate it, within the same clause ("har aldrig haft självmordstankar"). */
const NEGATION_LOOKBACK = 2;

/**
 * Where the phrase's words occur in order, with at most MAX_GAP words between. `negated`
 * is true when a negation that is not part of the phrase stands between its words or just
 * before it ("vill inte dö", "tänker inte göra mig illa"). A plain occurrence wins over a
 * negated one.
 */
function phraseIn(
  words: string[],
  guarded: boolean[],
  phrase: string[],
  /** A core word: the first word only has to start with it. */
  prefix = false,
): { found: boolean; negated: boolean } {
  if (!phrase.length) return { found: false, negated: false };
  const own = (w: string) => phrase.includes(w);
  let negatedHit = false;
  for (let start = 0; start < words.length; start++) {
    const first = prefix ? !guarded[start] && words[start].startsWith(phrase[0]) : tokenEq(words[start], phrase[0], guarded[start]);
    if (!first) continue;
    let pos = start;
    let ok = true;
    let negated = words.slice(Math.max(0, start - NEGATION_LOOKBACK), start).some((w) => NEGATIONS.has(w) && !own(w));
    for (let k = 1; k < phrase.length && ok; k++) {
      ok = false;
      for (let gap = 0; gap <= MAX_GAP && pos + 1 + gap < words.length; gap++) {
        const w = words[pos + 1 + gap];
        if (tokenEq(w, phrase[k], guarded[pos + 1 + gap])) {
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
  return akutCheckWith(note, akutLists(), userPhrases);
}

/** The emergency rule against given lists; akutCheck uses context/akut.md. */
export function akutCheckWith(note: string, lists: AkutLists, userPhrases: string[] = []): AkutResult {
  const parts = clauses(note);
  if (!parts.length) return { level: null, phrases: [] };
  const exceptions = lists.exceptions.map(tokenize);
  const masks = parts.map((words) => guardMask(words, exceptions));
  const candidates: { text: string; tokens: string[]; prefix: boolean }[] = [
    ...[...lists.phrases, ...userPhrases].filter((x) => x.trim()).map((text) => ({ text, tokens: tokenize(text), prefix: false })),
    ...lists.cores.filter((x) => x.trim()).map((text) => ({ text, tokens: tokenize(text), prefix: true })),
  ];
  const full: string[] = [];
  const mild: string[] = [];
  for (const c of candidates) {
    let hit: { found: boolean; negated: boolean } = { found: false, negated: false };
    for (let i = 0; i < parts.length; i++) {
      const h = phraseIn(parts[i], masks[i], c.tokens, c.prefix);
      if (h.found && !h.negated) { hit = h; break; }
      if (h.found) hit = h;
    }
    if (hit.found) (hit.negated ? mild : full).push(c.text);
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

/**
 * What the crisis card shows: the person's own steps at red, the plan's ladder (numbered,
 * under the plan's own heading), then the numbers.
 */
export function crisisInfo(plan: PlanItem[]): { steps: string[]; ladder: { heading: string; steps: string[] } | null; numbers: CrisisNumber[] } {
  const ladder = ladderOf(plan);
  return {
    steps: actionsFor('red', plan).map((p) => p.text),
    ladder: ladder ? { heading: ladder.heading, steps: ladder.steps.map((p) => p.text) } : null,
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
