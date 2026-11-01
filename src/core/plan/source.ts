// Reads a crisis plan into lines with their structure: heading level, list marker, indent
// and page. Three sources: pasted text, a PDF (text extracted on the phone with pdf.js) and
// a .docx file. Nothing here leaves the phone.

import { strFromU8, unzipSync } from 'fflate';
import { headingRules, matchHeading, normalizeHeading } from './headingRules';

export interface SourceLine {
  text: string;
  /** 1-based page, from page breaks, page numbers or the PDF itself. */
  page: number;
  /** Heading level, 1 is the largest. Null for ordinary lines. */
  heading: number | null;
  list: 'bullet' | 'number' | null;
  number: number | null;
  /** List nesting, 0 for the outermost level. */
  indent: number;
  /** A blank line or a larger gap comes before the line. */
  gapBefore: boolean;
  /** The heading level is a guess from the rules table, not from the source (plain text). */
  guessed?: boolean;
}

export type SourcePages = SourceLine[][];

const BULLET = /^(\s*)([-–—•*·●○▪■◦])\s+/;
const NUMBER = /^(\s*)(\d{1,2})[.)]\s+/;
const LETTER = /^(\s*)([a-z])[.)]\s+/;
/** "Sida 2 av 3", "2/3", "- 2 -", "Sida 2". */
export const PAGE_NUMBER = /^(?:sida|s\.|page)?\s*-?\s*\d{1,3}\s*(?:(?:av|\/|of)\s*\d{1,3})?\s*-?$/i;

function marker(raw: string): { list: SourceLine['list']; number: number | null; indent: number; text: string } {
  const lead = raw.match(/^[ \t]*/)?.[0] ?? '';
  const indent = Math.floor(lead.replace(/\t/g, '  ').length / 2);
  let m = raw.match(BULLET);
  if (m) return { list: 'bullet', number: null, indent, text: raw.slice(m[0].length).trim() };
  m = raw.match(NUMBER);
  if (m) return { list: 'number', number: Number(m[2]), indent, text: raw.slice(m[0].length).trim() };
  m = raw.match(LETTER);
  if (m) return { list: 'number', number: m[2].charCodeAt(0) - 96, indent: indent + 1, text: raw.slice(m[0].length).trim() };
  return { list: null, number: null, indent: 0, text: raw.trim() };
}

/**
 * Guesses whether an unmarked line is a heading: short, no full stop at the end, and
 * either a heading the rules table knows, a line ending in a colon, or a line followed by
 * a list. The level comes from the table (huvud 1, under 2); unknown headings get 1.
 */
function guessHeading(text: string, nextIsList: boolean): number | null {
  const t = text.replace(/[*_]/g, '').trim();
  if (!t || t.length > 70 || /[.!?]$/.test(t) || PAGE_NUMBER.test(t)) return null;
  // "Tidiga tecken: sover mindre" is a heading with rows on the same line; the tree splits it.
  if (/:\s*\S/.test(t)) return null;
  const m = matchHeading(t.replace(/:$/, ''), headingRules());
  // A known heading must be mostly the pattern, so a row like "Pratar om mani" stays a row.
  if (m.known && normalizeHeading(t).split(' ').length <= 9) return m.level === 'under' ? 2 : 1;
  if (/:$/.test(t) || nextIsList) return 1;
  return null;
}

/** Pasted text or markdown. Page breaks: form feeds and page number lines ("Sida 1 av 3"). */
export function linesFromText(text: string): SourcePages {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const usesHashes = raw.some((l) => /^#{1,6}\s+\S/.test(l));
  const pages: SourcePages = [[]];
  let gap = false;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (line.includes('\f')) {
      pages.push([]);
      gap = true;
      continue;
    }
    if (!line.trim()) {
      gap = true;
      continue;
    }
    const page = pages.length;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    let out: SourceLine;
    if (h) {
      out = { text: h[2].replace(/[*_]/g, '').trim(), page, heading: h[1].length, list: null, number: null, indent: 0, gapBefore: gap };
    } else {
      const m = marker(line);
      let heading: number | null = null;
      if (!m.list && !usesHashes) {
        const next = raw.slice(i + 1).find((l) => l.trim());
        heading = guessHeading(m.text, !!next && !!marker(next).list);
      }
      out = {
        text: heading ? m.text.replace(/[*_]/g, '').replace(/:$/, '').trim() : m.text, page, heading, list: m.list, number: m.number, indent: m.indent, gapBefore: gap,
        ...(heading ? { guessed: true } : {}),
      };
    }
    pages[pages.length - 1].push(out);
    gap = false;
    // A page number ends the page; the header of the next page follows it.
    if (!out.heading && !out.list && PAGE_NUMBER.test(out.text)) pages.push([]);
  }
  return pages.filter((p) => p.length);
}

// ---- PDF ----

/** One text item from pdf.js: its string, font size, x and y (from the bottom of the page). */
export interface PdfItem {
  str: string;
  size: number;
  x: number;
  y: number;
}

/** Lines from pdf.js items. Headings are lines in a larger font than the body text. */
export function linesFromPdfItems(pages: PdfItem[][]): SourcePages {
  // Group items into visual lines per page, top to bottom.
  const grouped = pages.map((items) => {
    const lines: { y: number; x: number; size: number; text: string }[] = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      const l = lines.find((x) => Math.abs(x.y - it.y) < Math.max(2, it.size * 0.3));
      if (l) {
        if (it.x < l.x) { l.text = `${it.str} ${l.text}`; l.x = it.x; } else l.text = `${l.text}${/\s$/.test(l.text) ? '' : ' '}${it.str}`;
        l.size = Math.max(l.size, it.size);
      } else lines.push({ y: it.y, x: it.x, size: it.size, text: it.str });
    }
    return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).sort((a, b) => b.y - a.y || a.x - b.x);
  });

  // The body size is the size most characters have.
  const bySize = new Map<number, number>();
  for (const p of grouped) for (const l of p) bySize.set(Math.round(l.size), (bySize.get(Math.round(l.size)) ?? 0) + l.text.length);
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
  const headingSizes = [...bySize.keys()].filter((s) => s > body * 1.08).sort((a, b) => b - a);
  const bodyLines = grouped.flat().filter((l) => Math.round(l.size) === body);
  const leftX = bodyLines.length ? Math.min(...bodyLines.map((l) => l.x)) : 0;

  const out: SourcePages = [];
  grouped.forEach((lines, pi) => {
    const page: SourceLine[] = [];
    let prev: { x: number; y: number; explicit: boolean } | null = null;
    let prevOut: SourceLine | null = null;
    /** x of each open list level, outermost first. */
    let columns: number[] = [];
    for (const l of lines) {
      const level = headingSizes.indexOf(Math.round(l.size));
      const step = prev ? prev.y - l.y : 0;
      const gapBefore = !prev || step > l.size * 1.75;
      if (level >= 0) {
        prevOut = { text: l.text, page: pi + 1, heading: level + 1, list: null, number: null, indent: 0, gapBefore: true };
        page.push(prevOut);
        prev = { x: l.x, y: l.y, explicit: false };
        columns = [];
        continue;
      }
      const m = marker(l.text);
      // Smaller text (headers, footers, footnotes) is never a list point.
      const indented = l.x > leftX + 6 && Math.round(l.size) >= body;
      if (prev && prevOut && !prevOut.heading && !m.list && !gapBefore) {
        const sameColumn = Math.abs(l.x - prev.x) < 4;
        const wrapped = prevOut.list
          ? (prev.explicit && l.x > prev.x + 4) || (sameColumn && /^[a-zåäö0-9(,–-]/.test(l.text))
          : sameColumn && !indented;
        if (wrapped) {
          prevOut.text = `${prevOut.text} ${l.text}`.replace(/\s+/g, ' ');
          prev = { ...prev, y: l.y };
          continue;
        }
      }
      // Lists without a visible mark are recognised by their indent.
      const list = m.list ?? (indented ? 'bullet' : null);
      let indent = 0;
      if (list) {
        if (!prevOut?.list) columns = [l.x];
        else {
          while (columns.length > 1 && l.x < columns[columns.length - 1] - 6) columns.pop();
          if (l.x > columns[columns.length - 1] + 12) columns.push(l.x);
        }
        indent = columns.length - 1;
      } else columns = [];
      const heading = !list && matchHeading(m.text, headingRules()).known ? guessHeading(m.text, false) : null;
      prevOut = { text: m.text, page: pi + 1, heading, list, number: m.number, indent, gapBefore };
      page.push(prevOut);
      prev = { x: l.x, y: l.y, explicit: !!m.list };
    }
    out.push(page);
  });
  return out;
}

/** Reads a PDF on the phone. pdf.js is loaded only when a PDF is opened. */
type PdfLib = { getDocumentProxy: (data: Uint8Array) => Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> }> };

export async function readPdfItems(data: Uint8Array, load: () => Promise<PdfLib> = () => import('unpdf') as Promise<PdfLib>): Promise<PdfItem[][]> {
  const { getDocumentProxy } = await load();
  const pdf = await getDocumentProxy(data);
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    pages.push(
      (content.items as { str?: string; transform?: number[] }[])
        .filter((it) => typeof it.str === 'string' && it.transform)
        .map((it) => ({ str: it.str!, size: Math.abs(it.transform![3]), x: it.transform![4], y: it.transform![5] })),
    );
  }
  return pages;
}

export async function linesFromPdf(data: Uint8Array, load?: () => Promise<PdfLib>): Promise<SourcePages> {
  return linesFromPdfItems(await readPdfItems(data, load));
}

// ---- .docx ----

function xmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<w:br[^>]*\/>/g, ' ')
    .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, '\u0000$1\u0001')
    .replace(/[^\u0000\u0001]*?\u0000([^\u0001]*)\u0001/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function paragraphs(xml: string): string[] {
  return xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? [];
}

/** Bullet or number per numId and level, from word/numbering.xml. */
function numberFormats(xml: string | null): (numId: string, ilvl: number) => 'bullet' | 'number' {
  if (!xml) return () => 'bullet';
  const abstract = new Map<string, Map<number, string>>();
  for (const a of xml.match(/<w:abstractNum [\s\S]*?<\/w:abstractNum>/g) ?? []) {
    const id = a.match(/w:abstractNumId="(\d+)"/)?.[1];
    if (!id) continue;
    const levels = new Map<number, string>();
    for (const l of a.match(/<w:lvl [\s\S]*?<\/w:lvl>/g) ?? []) {
      levels.set(Number(l.match(/w:ilvl="(\d+)"/)?.[1] ?? 0), l.match(/<w:numFmt w:val="([^"]+)"/)?.[1] ?? 'bullet');
    }
    abstract.set(id, levels);
  }
  const nums = new Map<string, string>();
  for (const n of xml.match(/<w:num w:numId="\d+"[\s\S]*?<\/w:num>/g) ?? []) {
    const numId = n.match(/w:numId="(\d+)"/)?.[1];
    const abs = n.match(/<w:abstractNumId w:val="(\d+)"/)?.[1];
    if (numId && abs) nums.set(numId, abs);
  }
  return (numId, ilvl) => (abstract.get(nums.get(numId) ?? '')?.get(ilvl) ?? 'bullet') === 'bullet' ? 'bullet' : 'number';
}

export interface DocxRead {
  pages: SourcePages;
  /** Text in the document's own headers and footers. Never part of the plan. */
  furniture: string[];
}

/** A .docx file: headings from the paragraph styles, lists from the numbering. Headers and footers are separate parts. */
export function linesFromDocx(data: Uint8Array): DocxRead {
  const files = unzipSync(data, { filter: (f) => /^word\/(document|numbering|header\d*|footer\d*)\.xml$/.test(f.name) });
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('Filen ser inte ut som ett Word-dokument.');
  const fmt = numberFormats(files['word/numbering.xml'] ? strFromU8(files['word/numbering.xml']) : null);
  const counters = new Map<string, number>();
  const page: SourceLine[] = [];
  const pages: SourcePages = [page];
  let gap = false;
  const xml = strFromU8(doc);
  const paras = paragraphs(xml);
  paras.forEach((p, i) => {
    const text = xmlText(p);
    if (/<w:br [^>]*w:type="page"/.test(p) || /<w:pageBreakBefore\/>/.test(p)) pages.push([]);
    if (!text) { gap = true; return; }
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
    const hl = style.match(/(?:heading|rubrik)\s*(\d)/i);
    let heading: number | null = hl ? Number(hl[1]) : /^(title|rubrik)$/i.test(style) ? 1 : null;
    // Numbering starts over under each heading, as the plan is read.
    if (heading) counters.clear();
    const numId = p.match(/<w:numId w:val="(\d+)"/)?.[1];
    const ilvl = Number(p.match(/<w:ilvl w:val="(\d+)"/)?.[1] ?? 0);
    let list: SourceLine['list'] = null;
    let number: number | null = null;
    if (numId && numId !== '0' && !heading) {
      list = fmt(numId, ilvl);
      if (list === 'number') {
        const k = `${numId}:${ilvl}`;
        number = (counters.get(k) ?? 0) + 1;
        counters.set(k, number);
      }
    }
    const m = list ? { list, number, indent: ilvl, text } : marker(text);
    if (!heading && !m.list) {
      const bold = /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(p);
      const next = paras.slice(i + 1).map(xmlText).find(Boolean);
      const nextIsList = !!next && (/<w:numId w:val="[1-9]/.test(paras[i + 1] ?? '') || !!marker(next).list);
      const g = guessHeading(m.text, nextIsList);
      if (g && (bold || matchHeading(m.text, headingRules()).known)) heading = g;
    }
    pages[pages.length - 1].push({ text: m.text, page: pages.length, heading, list: m.list, number: m.number, indent: m.indent, gapBefore: gap });
    gap = false;
  });
  const furniture = Object.entries(files)
    .filter(([name]) => /header|footer/.test(name))
    .flatMap(([, f]) => paragraphs(strFromU8(f)).map(xmlText))
    .filter(Boolean);
  return { pages: pages.filter((p) => p.length), furniture: Array.from(new Set(furniture)) };
}
