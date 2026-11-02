// The emergency rule. Matched in code, on the phone, before any model call and
// independently of it, also without network. The word list (context/akut.md) and the
// user's own emergency phrases are never sent to a model.

import { CONTEXT_SOURCES } from '../prompts/bundle.generated';
import { parseFrontmatter } from '../prompts/loader';
import type { PlanItem } from '../domain/types';
import { tokenize, wordsMatch } from '../analysis/wordmatch';
import { actionsFor, ladderOf } from '../plan/guidance';

const NEGATIONS = new Set(['inte', 'aldrig', 'ingen', 'inget', 'inga', 'ej']);
/** Words allowed between the words of a phrase ("vill verkligen just nu dö"). A negation there makes the hit mild. */
const MAX_GAP = 3;
/** Someone else as the subject of a clause, when the person does not write about themselves in it. */
const THIRD_PERSON = new Set(['han', 'hon', 'hen']);
const FIRST_PERSON = new Set(['jag', 'mig', 'ja']);

export interface AkutLists {
  /** Phrases matched word by word, tolerating inflections and up to two words between. */
  phrases: string[];
  /** Core words that match as the start of a word, however long the rest: "självmord" in "självmordsförsök". */
  cores: string[];
  /** Known false hits. Their words may only match a phrase word that is spelled the same, never as an inflection. */
  exceptions: string[];
  /**
   * Words that place a hit in the past, with someone else or in a topic ("för tio år sedan",
   * "min vän", "självmordsprevention", "av skratt"). In the same clause they make a full hit
   * mild: the crisis card shows, but the day is not made red.
   */
  contexts?: string[];
}

const SECTION: Record<string, keyof AkutLists> = { fraser: 'phrases', 'kärnord': 'cores', undantag: 'exceptions', sammanhang: 'contexts' };

export function parseAkutLists(source: string): AkutLists {
  const { body } = parseFrontmatter(source);
  const out: AkutLists = { phrases: [], cores: [], exceptions: [], contexts: [] };
  let into: keyof AkutLists | null = null;
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      into = SECTION[h[1].toLowerCase()] ?? null;
      continue;
    }
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (into && m) (out[into] ??= []).push(m[1]);
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

/** Repeated letters written once: "döö" is "dö", "viiill" is "vil". */
function squeeze(word: string): string {
  return word.replace(/(.)\1+/g, '$1');
}

function tokenEq(word: string, token: string, guarded: boolean): boolean {
  if (word === token) return true;
  // A word inside a known false hit ("skärper mig") is never taken as an inflection.
  if (guarded) return false;
  // Letters held for emphasis ("döö", "viiill").
  if (squeeze(word) === squeeze(token)) return true;
  // Short words must be equal; longer ones may be inflections ("skadar" / "skada").
  return Math.min(word.length, token.length) >= 4 && wordsMatch(word, token);
}

/** Edit distance with swaps, stopping early above 1. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length] <= 1;
}

/**
 * A word that starts with a core word, also with one letter wrong, missing or swapped in a
 * long core ("sjävmordstankar"). Short cores must be spelled right: "suicid" stays exact.
 */
function startsWithCore(word: string, core: string): boolean {
  if (word.startsWith(core)) return true;
  if (core.length < 8) return false;
  for (const len of [core.length - 1, core.length, core.length + 1]) {
    if (len <= word.length && withinOneEdit(word.slice(0, len), core)) return true;
  }
  return false;
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
    const first = prefix ? !guarded[start] && startsWithCore(words[start], phrase[0]) : tokenEq(words[start], phrase[0], guarded[start]);
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

/** A context word in the clause: in the past, someone else, or a topic rather than the person's own state now. */
function contextIn(words: string[], contexts: string[][], cores: string[]): boolean {
  const own = words.some((w) => FIRST_PERSON.has(w));
  if (!own && words.some((w) => THIRD_PERSON.has(w))) return true;
  for (const c of contexts) {
    if (!c.length) continue;
    if (c.length === 1) {
      const cue = c[0];
      // "självmordsprevention", "självmordsstatistiken": the topic sits inside the hit word.
      const inside = cue.length >= 5 && words.some((w) => cores.some((k) => startsWithCore(w, k)) && w.includes(cue));
      if (inside || words.some((w) => tokenEq(w, cue, false))) return true;
      continue;
    }
    for (let i = 0; i + c.length <= words.length; i++) {
      if (c.every((t, k) => tokenEq(words[i + k], t, false))) return true;
    }
  }
  return false;
}

export type AkutLevel = 'full' | 'mild';

export interface AkutResult {
  /** full: crisis card, red day, nothing sent. mild: gentler card, level unchanged, nothing sent to the model. */
  level: AkutLevel | null;
  phrases: string[];
  /** Why a hit is mild: a negation ("vill inte dö") or a context ("för tio år sedan", "min vän"). */
  mildBecause?: 'negation' | 'context';
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
  const contexts = (lists.contexts ?? []).map(tokenize);
  const cores = lists.cores.map((c) => tokenize(c)[0]).filter(Boolean);
  const full: string[] = [];
  const mild: string[] = [];
  let byContext = false;
  for (const c of candidates) {
    let hit: { found: boolean; negated: boolean; context: boolean } = { found: false, negated: false, context: false };
    for (let i = 0; i < parts.length; i++) {
      const h = phraseIn(parts[i], masks[i], c.tokens, c.prefix);
      if (!h.found) continue;
      // The person's own phrases are always taken as written.
      const context = !h.negated && !userPhrases.includes(c.text) && contextIn(parts[i], contexts, cores);
      if (!h.negated && !context) { hit = { ...h, context: false }; break; }
      hit = { found: true, negated: h.negated, context };
    }
    if (!hit.found) continue;
    if (!hit.negated && !hit.context) full.push(c.text);
    else {
      mild.push(c.text);
      if (hit.context) byContext = true;
    }
  }
  if (full.length) return { level: 'full', phrases: full };
  if (mild.length) return { level: 'mild', phrases: mild, mildBecause: byContext ? 'context' : 'negation' };
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
