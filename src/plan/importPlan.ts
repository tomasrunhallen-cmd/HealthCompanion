// The whole import, step by step: lines from the source, page headers and footers removed,
// the row tree, then the rules table. Pure up to the model step; the review keeps the draft
// and saves it after every change, so a long plan can be reviewed over several sessions.

import type { Completer } from '../adapter/types';
import { classifyByRules, sortUnknownWithModel, type DraftPlanRow, type RowSource } from './classify';
import { stripPageFurniture } from './headers';
import { linesFromText, type SourcePages } from './source';
import { buildTree } from './tree';

export const DRAFT_KEY = 'planImportDraft';

export interface PlanDraft {
  version: 1;
  source: 'text' | 'pdf' | 'docx';
  sourceName: string | null;
  title: string | null;
  /** "Borttaget sidhuvud": shown to the person, never saved in the plan. Dropped with the draft. */
  removed: string[];
  rows: DraftPlanRow[];
  /** Headings with rows the rules did not know, in plan order. */
  unknown: { heading: string; ids: string[] }[];
  polarityWords: { up?: string; down?: string };
  /** The model that sorted the unknown headings, when one did. */
  model: string | null;
  /** Headings the person has folded away in the review. */
  collapsed: string[];
  createdAt: string;
  updatedAt: string;
}

export function draftFromPages(
  pages: SourcePages,
  source: PlanDraft['source'],
  opts: { furniture?: string[]; sourceName?: string | null; now?: Date } = {},
): PlanDraft {
  const { lines, removed } = stripPageFurniture(pages, opts.furniture);
  const tree = buildTree(lines);
  const rules = classifyByRules(tree.rows);
  const at = (opts.now ?? new Date()).toISOString();
  return {
    version: 1,
    source,
    sourceName: opts.sourceName ?? null,
    title: tree.title,
    removed: Array.from(new Set([...(opts.furniture ?? []), ...removed])),
    rows: rules.rows,
    unknown: rules.unknown,
    polarityWords: rules.polarityWords,
    model: null,
    collapsed: [],
    createdAt: at,
    updatedAt: at,
  };
}

export function draftFromText(text: string, now?: Date): PlanDraft {
  return draftFromPages(linesFromText(text), 'text', { now });
}

/** Rows still waiting for the model, i.e. under unknown headings and not sorted yet. */
export function pendingForModel(draft: PlanDraft): number {
  const needs = new Set(draft.rows.filter((r) => r.source === 'needs').map((r) => r.id));
  return draft.unknown.filter((g) => g.ids.some((id) => needs.has(id))).length;
}

export async function sortDraftWithModel(
  draft: PlanDraft,
  completer: Completer,
  model: string,
  names: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ draft: PlanDraft; failed: number }> {
  const res = await sortUnknownWithModel(completer, { rows: draft.rows, unknown: draft.unknown, polarityWords: draft.polarityWords }, names, onProgress);
  return { draft: { ...draft, rows: res.rows, model: res.sorted ? model : draft.model, updatedAt: new Date().toISOString() }, failed: res.failed };
}

export interface HeadingCount {
  total: number;
  rules: number;
  model: number;
  needs: number;
  approved: number;
}

export function countBySource(rows: DraftPlanRow[]): HeadingCount {
  const c: HeadingCount = { total: rows.length, rules: 0, model: 0, needs: 0, approved: 0 };
  for (const r of rows) {
    c[r.source as RowSource]++;
    if (r.approved) c.approved++;
  }
  return c;
}

export interface ReviewSection {
  heading: string;
  rows: DraftPlanRow[];
  count: HeadingCount;
}

/**
 * The review in the plan's order, by the plan's own headings. The grouping follows the
 * heading a row came from, never its current kind, so changing the kind never moves a card.
 * Rows that needed sorting when the draft was made are listed first, in their own section.
 */
export function reviewSections(draft: PlanDraft): { needs: DraftPlanRow[]; sections: ReviewSection[] } {
  const sections: ReviewSection[] = [];
  for (const r of draft.rows) {
    let s = sections[sections.length - 1];
    if (!s || s.heading !== r.heading) {
      s = sections.find((x) => x.heading === r.heading) ?? { heading: r.heading, rows: [], count: countBySource([]) };
      if (!sections.includes(s)) sections.push(s);
    }
    s.rows.push(r);
  }
  for (const s of sections) s.count = countBySource(s.rows);
  return { needs: draft.rows.filter((r) => r.source === 'needs'), sections };
}

export function updateRow(draft: PlanDraft, id: string, patch: Partial<DraftPlanRow>): PlanDraft {
  return {
    ...draft,
    rows: draft.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    updatedAt: new Date().toISOString(),
  };
}

/** "Godkänn alla under den här rubriken": every row with text under the heading. */
export function approveHeading(draft: PlanDraft, heading: string, approved = true): PlanDraft {
  return {
    ...draft,
    rows: draft.rows.map((r) => (r.heading === heading && r.text.trim() ? { ...r, approved } : r)),
    updatedAt: new Date().toISOString(),
  };
}

/** A sleep window in the plan's routines, e.g. "Sömn 22:30–07:00". Suggested, applied only after approval. */
export function sleepWindowIn(rows: Pick<DraftPlanRow, 'text' | 'fields'>[]): { start: string; end: string; text: string } | null {
  for (const r of rows) {
    if (r.fields.kind !== 'routine' && r.fields.kind !== 'action') continue;
    if (!/sömn|sova|sover|lägg(a|er) mig|sängen/i.test(r.text)) continue;
    const m = r.text.match(/(\d{1,2})[:.](\d{2})\s*(?:[–—-]|till)\s*(\d{1,2})[:.](\d{2})/);
    if (!m) continue;
    const hh = (h: string, mm: string) => `${h.padStart(2, '0')}:${mm}`;
    if (Number(m[1]) > 23 || Number(m[3]) > 23) continue;
    return { start: hh(m[1], m[2]), end: hh(m[3], m[4]), text: r.text };
  }
  return null;
}

/** Hours in a window that may cross midnight. */
export function windowHours(start: string, end: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let d = toMin(end) - toMin(start);
  if (d <= 0) d += 24 * 60;
  return d / 60;
}
