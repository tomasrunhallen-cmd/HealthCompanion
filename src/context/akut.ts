// The emergency rule. Matched in code, on the phone, before any model call and
// independently of it, also without network. The word list (context/akut.md) and the
// user's own emergency phrases are never sent to a model.

import { CONTEXT_SOURCES } from '../prompts/bundle.generated';
import { parseFrontmatter } from '../prompts/loader';
import type { PlanItem } from '../domain/types';
import { tokenize, wordsMatch } from '../analysis/wordmatch';

const NEGATIONS = new Set(['inte', 'aldrig', 'ingen', 'inget', 'inga', 'ej']);
/** Words allowed between the words of a phrase ("vill verkligen inte leva"). */
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

function tokenEq(a: string, b: string): boolean {
  // Short words must be equal; longer ones may be inflections ("skadar" / "skada").
  return a === b || (Math.min(a.length, b.length) >= 4 && wordsMatch(a, b));
}

/** True when the phrase's words occur in order, with at most MAX_GAP non-negation words between. */
function phraseIn(words: string[], phrase: string[]): boolean {
  if (!phrase.length) return false;
  for (let start = 0; start < words.length; start++) {
    if (!tokenEq(words[start], phrase[0])) continue;
    let pos = start;
    let ok = true;
    for (let k = 1; k < phrase.length && ok; k++) {
      ok = false;
      for (let gap = 0; gap <= MAX_GAP && pos + 1 + gap < words.length; gap++) {
        const w = words[pos + 1 + gap];
        if (tokenEq(w, phrase[k])) {
          pos = pos + 1 + gap;
          ok = true;
          break;
        }
        if (NEGATIONS.has(w) && !phrase.includes(w)) break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** The phrases that occur in the note. Empty when none. */
export function akutMatches(note: string, userPhrases: string[] = []): string[] {
  const words = tokenize(note);
  if (!words.length) return [];
  return [...akutPhrases(), ...userPhrases]
    .filter((p) => p.trim())
    .filter((p) => phraseIn(words, tokenize(p)));
}

export function isAkut(note: string, userPhrases: string[] = []): boolean {
  return akutMatches(note, userPhrases).length > 0;
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

/** Crisis plan lines that match the list stay on the phone: they are taken out before a model sees the plan. */
export function splitAkutLines(text: string, userPhrases: string[] = []): { kept: string; akut: string[] } {
  const kept: string[] = [];
  const akut: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() && isAkut(line, userPhrases)) akut.push(line.replace(/^\s*(?:[-–—•*·]|\d+[.)])\s+/, '').trim());
    else kept.push(line);
  }
  return { kept: kept.join('\n'), akut };
}
