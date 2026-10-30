// Removes personal data from text before it reaches any language model.
// Pure function, runs on the phone, also when the model is local.

export type ScrubKind =
  | 'personnummer'
  | 'telefon'
  | 'epost'
  | 'url'
  | 'adress'
  | 'postnummer'
  | 'namn'
  | 'journal';

export interface ScrubFinding {
  kind: ScrubKind;
  start: number;
  end: number;
  original: string;
}

export interface ScrubResult {
  text: string;
  findings: ScrubFinding[];
}

export const REPLACEMENT: Record<ScrubKind, string> = {
  personnummer: '[PERSONNUMMER]',
  telefon: '[TELEFON]',
  epost: '[E-POST]',
  url: '[LÄNK]',
  adress: '[ADRESS]',
  postnummer: '[ADRESS]',
  namn: '[NAMN]',
  journal: '[JOURNAL]',
};

const L = 'A-Za-zÅÄÖåäöÉéÜü';
/** Start-of-token boundary without lookbehind (works on every JS engine). */
const B = `(^|[^${L}0-9])`;

interface Pattern {
  kind: ScrubKind;
  /** Group 1 is the boundary, group 2 the payload. */
  re: RegExp;
}

function p(kind: ScrubKind, body: string, flags = 'g'): Pattern {
  return { kind, re: new RegExp(`${B}(${body})(?![${L}0-9])`, flags) };
}

// Order matters: earlier patterns win when ranges overlap.
const PATTERNS: Pattern[] = [
  { kind: 'epost', re: new RegExp(`${B}([${L}0-9._%+-]+@[${L}0-9.-]+\\.[A-Za-z]{2,})`, 'g') },
  { kind: 'url', re: new RegExp(`${B}((?:https?:\\/\\/|www\\.)[^\\s]+)`, 'gi') },
  p('personnummer', '(?:19|20)?\\d{2}(?:0[1-9]|1[0-2])(?:[0-6]\\d|[78]\\d)[-+ ]?\\d{4}'),
  p('telefon', '(?:\\+46|0046|0)[\\s-]?\\(?\\d{1,3}\\)?(?:[\\s-]?\\d){5,9}'),
  p(
    'journal',
    '(?:avd(?:elning)?\\.?\\s*\\d+[A-Za-z]?|(?:patient|journal)[\\s-]?(?:id|nr|nummer)?[:.]?\\s*[A-Za-z0-9-]*\\d[A-Za-z0-9-]*|vårdavdelning\\s*\\d+)',
    'gi',
  ),
  p(
    'adress',
    `[${L}]+(?:gatan|vägen|gränd|gränden|torget|torg|backen|stigen|allén|allé|plan|leden|gata|väg|esplanaden|kajen|parken|stråket|slingan)\\s+\\d+(?:\\s?[A-Za-z])?(?:\\s*,?\\s*(?:lgh|lägenhet)\\s*\\d+)?`,
    'gi',
  ),
  p('postnummer', `\\d{3}\\s?\\d{2}\\s+[A-ZÅÄÖ][${L}]+`),
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namePatterns(names: string[]): Pattern[] {
  const cleaned = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2)),
  ).sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) return [];
  // Also catch Swedish genitive "Annas" and "Anna:s".
  const alt = cleaned.map(escapeRegex).join('|');
  return [p('namn', `(?:${alt})(?::?s)?`, 'gi')];
}

function collect(text: string, patterns: Pattern[]): ScrubFinding[] {
  const found: ScrubFinding[] = [];
  for (const { kind, re } of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index + m[1].length;
      const original = m[2];
      const end = start + original.length;
      found.push({ kind, start, end, original });
      // Continue right after the payload so adjacent matches are not swallowed.
      re.lastIndex = end;
      if (original.length === 0) re.lastIndex++;
    }
  }
  // Keep the first pattern's match when ranges overlap.
  const accepted: ScrubFinding[] = [];
  for (const f of found) {
    if (!accepted.some((a) => f.start < a.end && a.start < f.end)) accepted.push(f);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Scrubs text. `names` is the user's own list plus names found in the crisis plan.
 */
export function scrub(text: string, names: string[] = []): ScrubResult {
  const findings = collect(text, [...PATTERNS, ...namePatterns(names)]);
  let out = '';
  let pos = 0;
  for (const f of findings) {
    out += text.slice(pos, f.start) + REPLACEMENT[f.kind];
    pos = f.end;
  }
  out += text.slice(pos);
  return { text: out, findings };
}

/**
 * Picks likely names out of crisis plan text: capitalised words that are not at the start
 * of a sentence and not common Swedish words. The user reviews the list before use.
 */
export function namesFromPlanText(text: string): string[] {
  const common = new Set([
    'Jag', 'Min', 'Mitt', 'Mina', 'Vid', 'Om', 'När', 'Ring', 'Kontakta', 'Ta', 'Gå', 'Sov',
    'Tidiga', 'Allvarliga', 'Tecken', 'Åtgärder', 'Anhöriga', 'Psykiatrin', 'Vårdcentralen',
    'Akuten', 'Det', 'Den', 'De', 'Be', 'Säg', 'Försök', 'Undvik', 'Gult', 'Rött', 'Grönt',
  ]);
  const result = new Set<string>();
  // A capitalised word preceded by a word character and a space (so not the first word of a line or sentence).
  const re = new RegExp(`([${L}0-9,]\\s)([A-ZÅÄÖ][a-zåäöéü]{1,})`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[2];
    if (!common.has(word)) result.add(word);
    re.lastIndex = m.index + m[0].length;
  }
  return Array.from(result);
}
