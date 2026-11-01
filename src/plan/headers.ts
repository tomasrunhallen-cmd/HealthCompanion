// Removes page headers and footers: lines that repeat at the top or bottom of the pages
// (name, personnummer, address) and page numbers. They are shown to the person as
// "Borttaget sidhuvud" and never saved.

import { PAGE_NUMBER, type SourceLine, type SourcePages } from './source';

/** How many lines at each edge of a page count as header or footer. */
const EDGE = 3;
const PERSONNUMMER = /(?:19|20)?\d{6}[-+ ]?\d{4}/;

function key(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface Stripped {
  lines: SourceLine[];
  /** The removed lines, each once, in the order first seen. */
  removed: string[];
}

export function stripPageFurniture(pages: SourcePages, known: string[] = []): Stripped {
  const knownKeys = new Set(known.map(key));
  const edgeCount = new Map<string, number>();
  const edges = pages.map((page) => {
    const idx = new Set<number>();
    for (let i = 0; i < Math.min(EDGE, page.length); i++) idx.add(i);
    for (let i = Math.max(0, page.length - EDGE); i < page.length; i++) idx.add(i);
    return idx;
  });
  pages.forEach((page, pi) => {
    const seen = new Set<string>();
    for (const i of edges[pi]) {
      const k = key(page[i].text);
      if (seen.has(k)) continue;
      seen.add(k);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  });
  // Repeated on at least two pages, and on at least half of them.
  const need = Math.max(2, Math.ceil(pages.length / 2));
  const isFurniture = (line: SourceLine, atEdge: boolean): boolean => {
    const k = key(line.text);
    if (knownKeys.has(k)) return true;
    if (!line.heading && PAGE_NUMBER.test(line.text.trim())) return true;
    if (!atEdge) return false;
    if (pages.length > 1 && (edgeCount.get(k) ?? 0) >= need) return true;
    // A personnummer at the top of a page is a header, also on a one-page plan.
    return !line.list && PERSONNUMMER.test(line.text) && line.text.length < 120;
  };

  const removed: string[] = [];
  const lines: SourceLine[] = [];
  pages.forEach((page, pi) => {
    let dropped = false;
    page.forEach((line, i) => {
      if (isFurniture(line, edges[pi].has(i))) {
        if (!removed.some((r) => key(r) === key(line.text))) removed.push(line.text);
        dropped = true;
        return;
      }
      // A row split by a page break carries on; the gap left by the header is not a real gap.
      lines.push(dropped && i > 0 && lines.length ? { ...line, gapBefore: line.gapBefore && !!line.heading } : line);
      dropped = false;
    });
  });
  return { lines, removed };
}
