// The crisis plan's row fields (kind, polarity, severity, observer, when, who, order) and how
// they map to the context bank's kinds. The fields are what the person reviews; the bank's
// kind follows from them, so the scoring keeps counting early and serious signs as before.

import type { ContextKind, PlanFields, PlanSettings, Polarity, RowKind } from '../domain/types';

export const ROW_KINDS: RowKind[] = ['sign', 'trigger', 'action', 'routine', 'contact', 'value_anchor', 'wish', 'note_for_care', 'ignore'];

export const ROW_KIND_TEXT: Record<RowKind, string> = {
  sign: 'Tecken',
  trigger: 'Risksituation',
  action: 'Åtgärd',
  routine: 'Livsstil och rutin',
  contact: 'Kontakt',
  value_anchor: 'Värdeankare',
  wish: 'Önskemål',
  note_for_care: 'Till vården',
  ignore: 'Spara inte',
};

export const SEVERITY_TEXT = { early: 'Tidigt', serious: 'Allvarligt' } as const;
export const OBSERVER_TEXT = { self: 'Jag märker', others: 'Andra ser' } as const;
export const WHEN_TEXT = { early: 'Vid tidiga tecken', serious: 'Vid allvarlig försämring', always: 'Alltid' } as const;
export const WHO_TEXT = { me: 'Jag', relative: 'Närstående', care: 'Vården' } as const;

/** Neutral words, used when the plan has no words of its own (principle 7: no diagnosis words). */
export const NEUTRAL_POLARITY: Record<'up' | 'down', string> = { up: 'uppvarvad', down: 'nedstämd' };

/** The words shown for each direction: the plan's own if it has them, otherwise neutral ones. */
export function polarityWord(dir: 'up' | 'down', settings: Pick<PlanSettings, 'polarityWords'> | null | undefined): string {
  const own = settings?.polarityWords?.[dir]?.trim();
  return own || NEUTRAL_POLARITY[dir];
}

export function polarityText(p: Polarity, settings: Pick<PlanSettings, 'polarityWords'> | null | undefined): string {
  if (p === 'both') return 'Båda';
  const w = polarityWord(p, settings);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Fills in what a kind needs and drops what it cannot have. */
export function normalizeFields(f: PlanFields): PlanFields {
  const base: PlanFields = { kind: f.kind, polarity: f.polarity ?? 'both', ...(f.sourceHeading ? { sourceHeading: f.sourceHeading } : {}) };
  if (f.kind === 'sign') return { ...base, severity: f.severity ?? 'early', observer: f.observer ?? 'self' };
  if (f.kind === 'action') return { ...base, when: f.when ?? 'always', who: f.who ?? 'me', order: f.order ?? null };
  return base;
}

/** The context bank kind a row is saved as. Null for rows that are not saved. */
export function contextKindOf(f: PlanFields): ContextKind | null {
  switch (f.kind) {
    case 'sign':
      return f.severity === 'serious' ? 'serious' : 'early';
    case 'action':
      if (f.who === 'relative') return 'relatives';
      return f.when === 'serious' ? 'action_red' : 'action_yellow';
    case 'trigger':
    case 'routine':
    case 'contact':
    case 'value_anchor':
    case 'wish':
    case 'note_for_care':
      return f.kind;
    case 'ignore':
      return null;
  }
}

/** Fields for an entry saved before the fields existed, from its kind. Polarity is "both" until the person changes it. */
export function fieldsFromKind(kind: ContextKind): PlanFields | null {
  switch (kind) {
    case 'early':
      return { kind: 'sign', polarity: 'both', severity: 'early', observer: 'self' };
    case 'serious':
      return { kind: 'sign', polarity: 'both', severity: 'serious', observer: 'self' };
    case 'action_yellow':
      return { kind: 'action', polarity: 'both', when: 'early', who: 'me', order: null };
    case 'action_red':
      return { kind: 'action', polarity: 'both', when: 'serious', who: 'me', order: null };
    case 'relatives':
      return { kind: 'action', polarity: 'both', when: 'always', who: 'relative', order: null };
    case 'trigger':
    case 'routine':
    case 'contact':
    case 'value_anchor':
    case 'wish':
    case 'note_for_care':
      return { kind, polarity: 'both' };
    default:
      return null;
  }
}

/** True for rows that are never used in the assessment and never sent to a model. */
export function isPrivateKind(kind: ContextKind): boolean {
  return kind === 'wish' || kind === 'note_for_care' || kind === 'contact' || kind === 'akut';
}
