// Anhörigkort: a card for the people close to the person, made by the person when they are
// well. The signs that others can see, what the relatives do, the ladder to avoid compulsory
// care, and the contacts. Never the person's own experiences, wishes or notes for the care.

import { blockLines, type PlanBlock } from '../plan/blocks';
import { polarityWord } from '../plan/fields';
import type { PlanSettings } from '../domain/types';
import { reportHtml, type ReportPart } from './html';

export interface RelativesCard {
  signsUp: string[];
  signsDown: string[];
  signsOther: string[];
  early: string[];
  serious: string[];
  ladder: string[];
  contacts: string[];
}

const lines = (blocks: PlanBlock[], pred: (b: PlanBlock) => boolean) => blocks.filter(pred).flatMap((b) => blockLines(b.text).map((l) => l.text));

export function relativesCard(blocks: PlanBlock[]): RelativesCard {
  const seen = (b: PlanBlock) => b.observer === 'others';
  return {
    signsUp: lines(blocks, (b) => seen(b) && (b.type === 'early_up' || b.type === 'serious_up')),
    signsDown: lines(blocks, (b) => seen(b) && (b.type === 'early_down' || b.type === 'serious_down')),
    signsOther: lines(blocks, (b) => seen(b) && (b.type === 'early' || b.type === 'serious')),
    early: lines(blocks, (b) => b.type === 'relatives_early'),
    serious: lines(blocks, (b) => b.type === 'others_serious'),
    ladder: lines(blocks, (b) => b.type === 'ladder'),
    contacts: lines(blocks, (b) => b.type === 'contacts'),
  };
}

export function relativesCardHtml(card: RelativesCard, ps: Pick<PlanSettings, 'polarityWords'>): string {
  const anySigns = card.signsUp.length + card.signsDown.length + card.signsOther.length > 0;
  const parts: ReportPart[] = [
    { kind: 'text', text: 'Det här har jag skrivit när jag mådde bra, för att ni ska veta vad ni kan se och vad ni kan göra.' },
    { kind: 'heading', text: 'Tecken som ni kan se' },
  ];
  if (!anySigns) parts.push({ kind: 'text', text: 'Inga tecken är markerade som sådant andra ser.', muted: true });
  if (card.signsUp.length) parts.push({ kind: 'text', text: `När jag blir ${polarityWord('up', ps)}:` }, { kind: 'list', items: card.signsUp });
  if (card.signsDown.length) parts.push({ kind: 'text', text: `När jag blir ${polarityWord('down', ps)}:` }, { kind: 'list', items: card.signsDown });
  if (card.signsOther.length) parts.push({ kind: 'list', items: card.signsOther });
  parts.push(
    { kind: 'heading', text: 'Det här gör ni vid tidiga tecken' }, { kind: 'list', items: card.early },
    { kind: 'heading', text: 'Det här gör ni och vården om det blir allvarligt' }, { kind: 'list', items: card.serious },
  );
  if (card.ladder.length) parts.push({ kind: 'heading', text: 'Så undviker vi tvångsåtgärder, steg för steg' }, { kind: 'list', items: card.ladder, ordered: true });
  parts.push(
    { kind: 'heading', text: 'Kontakter' }, { kind: 'list', items: card.contacts },
    { kind: 'heading', text: 'Vid fara för liv' }, { kind: 'text', text: 'Ring 112. Sjukvårdsrådgivning 1177. Självmordslinjen 90101.' },
  );
  return reportHtml('Till mina närstående', 'Ur min krisplan', parts);
}
