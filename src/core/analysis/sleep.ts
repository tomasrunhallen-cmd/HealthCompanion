// Fallback when no Garmin data exists: read "sov X timmar" from the note.
// The value is always shown as estimated.

const NUMBER_WORDS: Record<string, number> = {
  noll: 0, en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8,
  nio: 9, tio: 10, elva: 11, tolv: 12, halv: 0.5,
};

function parseNumber(raw: string): number | null {
  const t = raw.toLowerCase().replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  return null;
}

/**
 * Finds phrases like "sov 4 timmar", "sov fyra timmar", "sov typ 5,5 h",
 * "fick 3 timmars sömn", "sovit 6 timmar". Returns hours or null.
 */
export function parseSleepHours(text: string): number | null {
  const t = text.toLowerCase();
  const num = '(\\d+(?:[.,]\\d+)?|noll|en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|elva|tolv)';
  const half = '(\\s+och\\s+en\\s+halv)?';
  const unit = '\\s*(?:timmar|timme|timmars|tim|h)\\b';
  const patterns = [
    new RegExp(`(?:sov|sovit|sovde)\\s+(?:bara\\s+|typ\\s+|ungefär\\s+|cirka\\s+|runt\\s+|kanske\\s+)*${num}${half}${unit}`),
    new RegExp(`${num}${half}${unit}s?\\s+(?:sömn|sovande)`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = parseNumber(m[1]);
      if (n === null) continue;
      const value = n + (m[2] ? 0.5 : 0);
      if (value >= 0 && value <= 24) return value;
    }
  }
  return null;
}

/** Counts words in a transcript. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[a-zåäöéü0-9]/i.test(w)).length;
}

/** Words per minute from a transcript and a recording duration. */
export function wordsPerMinute(text: string, durationSec: number): number | null {
  if (!durationSec || durationSec < 5) return null;
  const words = countWords(text);
  if (words < 5) return null;
  return Math.round((words / durationSec) * 60);
}
