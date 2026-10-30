// Structures a pasted crisis plan without a language model, by headings and bullet lines.
// Every row is shown to the user and approved before anything is saved (principle 1).
// From step 2 a language model can do the same job with prompts/krisplan-import.md.

import type { PlanItemKind } from '../domain/types';

export type DraftKind = PlanItemKind | 'normal' | 'unsorted';

export interface DraftRow {
  key: string;
  text: string;
  kind: DraftKind;
  approved: boolean;
}

const HEADINGS: { kind: DraftKind; re: RegExp }[] = [
  { kind: 'early', re: /(tidiga?|första|små)\s+(varnings)?tecken|tidiga signaler|varningssignaler|när det börjar/i },
  { kind: 'serious', re: /allvarliga?\s+(varnings)?tecken|sena\s+tecken|akuta?\s+tecken|när det är allvarligt/i },
  { kind: 'action_yellow', re: /(vid|om)\s+gult|gul(a)?\s+(nivå|läge|steg)|åtgärder\s+vid\s+tidiga|vad jag gör (vid|när det börjar|tidigt)/i },
  { kind: 'action_red', re: /(vid|om)\s+rött|röd(a)?\s+(nivå|läge|steg)|åtgärder\s+vid\s+allvarliga|vad jag gör (vid|när det är) allvarligt|akut(a)?\s+åtgärder/i },
  { kind: 'relatives', re: /anhöriga|närstående|familjen|vad (andra|min familj|mina anhöriga) (ska|kan) göra/i },
  { kind: 'normal', re: /normalläge|när jag mår bra|mitt vanliga jag|när allt är som vanligt/i },
];

const BULLET = /^\s*(?:[-–—•*·]|\d+[.)]|[a-z][.)])\s+/;

function isHeading(line: string): DraftKind | null {
  const stripped = line.replace(/[#*_:]/g, ' ').trim();
  if (stripped.length > 70) return null;
  for (const h of HEADINGS) if (h.re.test(stripped)) return h.kind;
  return null;
}

export function parsePlanText(text: string): DraftRow[] {
  const rows: DraftRow[] = [];
  let current: DraftKind = 'unsorted';
  let i = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = isHeading(line);
    if (heading && !BULLET.test(raw)) {
      current = heading;
      // "Tidiga tecken: sover mindre, pratar fort" keeps the rest of the line as rows.
      const rest = line.split(':').slice(1).join(':').trim();
      if (rest) {
        for (const part of rest.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
          rows.push({ key: `r${i++}`, text: part, kind: current, approved: false });
        }
      }
      continue;
    }
    const textOnly = line.replace(BULLET, '').trim();
    if (!textOnly) continue;
    rows.push({ key: `r${i++}`, text: textOnly, kind: current, approved: false });
  }
  return rows;
}

export const KIND_LABEL: Record<DraftKind, string> = {
  early: 'Tidigt tecken',
  serious: 'Allvarligt tecken',
  action_yellow: 'Åtgärd vid gult',
  action_red: 'Åtgärd vid rött',
  relatives: 'Anhöriga gör',
  normal: 'Normalläge',
  unsorted: 'Ej sorterad',
};

export const KIND_ORDER: DraftKind[] = [
  'early', 'serious', 'action_yellow', 'action_red', 'relatives', 'normal', 'unsorted',
];
