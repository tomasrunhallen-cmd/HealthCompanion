// Simple, deterministic matching of the user's own signs against a note.
// Used when no language model is configured, and as fallback when a model fails.

import type { PlanItem, SignMatch } from '../domain/types';

const STOPWORDS = new Set([
  'och', 'att', 'det', 'som', 'en', 'ett', 'på', 'i', 'är', 'av', 'för', 'med', 'till',
  'den', 'har', 'de', 'om', 'så', 'var', 'men', 'jag', 'mig', 'mitt', 'min', 'mina',
  'sig', 'sin', 'sitt', 'sina', 'man', 'vi', 'du', 'han', 'hon', 'hen', 'när', 'kan',
  'blir', 'bli', 'än', 'eller', 'hur', 'vad', 'då', 'ju', 'nu', 'också', 'efter',
  'från', 'under', 'över', 'mot', 'vid', 'utan', 'ha', 'hade', 'got', 'mycket', 'lite',
  'jätte', 'väldigt', 'typ', 'alla', 'allt', 'något', 'någon', 'några', 'mer', 'mest',
  'idag', 'dag', 'dagen', 'kväll', 'ikväll', 'börjar', 'att', 'ser', 'får', 'gör',
]);

/** Words that change meaning and must never be dropped. */
const KEEP = new Set(['inte', 'ingen', 'inget', 'inga', 'aldrig', 'utan']);

const NEGATIONS = new Set(['inte', 'ingen', 'inget', 'inga', 'aldrig', 'ej']);

/**
 * True when a sentence or quote carries a negation the sign itself does not have: "Jag har
 * inte slutat äta" against the sign "Slutar äta". Used on word matching's hits and on the
 * model's quotes, on the phone.
 */
export function negatedAgainst(text: string, signText: string): boolean {
  const sign = new Set(tokenize(signText));
  return tokenize(text).some((w) => NEGATIONS.has(w) && !sign.has(w));
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"'’´`]/g, '')
    .replace(/[^a-zåäöéü0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** Content words of a sign: stopwords removed, negations kept. */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => KEEP.has(t) || (!STOPWORDS.has(t) && t.length > 1));
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Two words match when equal, or when they share a long enough prefix to be
 * inflections of the same word ("svarar" / "svara", "sover" / "sov" does not).
 */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const shortest = Math.min(a.length, b.length);
  if (shortest < 4) return false;
  const p = commonPrefix(a, b);
  return p >= 4 && p >= shortest - 2;
}

/** Split into sentences, keeping the original text for quoting. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/([.!?…])\s+/g, '$1\n')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Shorten a sentence to at most `maxWords` words, centred on the matched words. */
export function quoteFrom(sentence: string, focusTokens: string[], maxWords = 12): string {
  const words = sentence.replace(/[.!?…]+$/, '').split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  const idx = words.findIndex((w) => {
    const n = normalize(w);
    return focusTokens.some((t) => wordsMatch(n, t));
  });
  const start = Math.max(0, Math.min(words.length - maxWords, (idx < 0 ? 0 : idx) - 3));
  return words.slice(start, start + maxWords).join(' ');
}

/**
 * A sign matches a sentence when every content word of the sign has a matching word
 * in that sentence. Signs with no content words are ignored.
 */
export function matchSigns(note: string, signs: PlanItem[]): SignMatch[] {
  const sentences = splitSentences(note);
  const matches: SignMatch[] = [];
  for (const sign of signs) {
    const needed = contentTokens(sign.text);
    if (needed.length === 0) continue;
    for (const sentence of sentences) {
      const words = tokenize(sentence);
      const ok = needed.every((t) => words.some((w) => wordsMatch(w, t))) && !negatedAgainst(sentence, sign.text);
      if (ok) {
        matches.push({ planItemId: sign.id, quote: quoteFrom(sentence, needed) });
        break;
      }
    }
  }
  return matches;
}
