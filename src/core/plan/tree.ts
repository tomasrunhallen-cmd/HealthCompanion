// Builds the plan's rows from its lines, in the plan's own order: every row knows its
// heading chain, list points under a point belong to that point, and running text becomes
// a row of its own. Ids are stable for the same text, so a review can be resumed.

import { headingRules, matchHeading } from './headingRules';
import type { SourceLine } from './source';

export interface PlanRow {
  /** Stable id: the same plan text gives the same ids. */
  id: string;
  text: string;
  /** The plan's headings above the row, outermost first. The document title is left out. */
  headings: string[];
  /** The list point this row is a sub-point of. */
  parentId: string | null;
  /** The number in a numbered list. */
  number: number | null;
  /** True for running text (not a list point). */
  paragraph: boolean;
}

export interface PlanTree {
  /** The document's title, when the plan has one heading above all others ("Krisplan"). */
  title: string | null;
  rows: PlanRow[];
}

/** "Tidiga tecken: sover mindre, pratar fort" is a heading followed by rows on the same line. */
function inlineHeading(line: SourceLine): { heading: string; level: number; parts: string[] } | null {
  if (line.list || line.heading) return null;
  const i = line.text.indexOf(':');
  if (i < 2 || i > 60) return null;
  const head = line.text.slice(0, i).trim();
  const m = matchHeading(head, headingRules());
  if (!m.known || head.split(/\s+/).length > 7) return null;
  const parts = line.text.slice(i + 1).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return { heading: head, level: m.level === 'under' ? 2 : 1, parts };
}

export function buildTree(lines: SourceLine[]): PlanTree {
  const headingIdx = lines.map((l, i) => (l.heading ? i : -1)).filter((i) => i >= 0);
  let title: string | null = null;
  let titleIdx = -1;
  if (headingIdx.length > 1) {
    const first = lines[headingIdx[0]];
    if (headingIdx.slice(1).every((i) => (lines[i].heading ?? 0) > (first.heading ?? 0))) {
      title = first.text;
      titleIdx = headingIdx[0];
    }
  }

  const rows: PlanRow[] = [];
  const stack: { level: number; text: string }[] = [];
  /** Open list points, outermost first, for sub-points. */
  let listStack: { indent: number; id: string }[] = [];
  let last: PlanRow | null = null;
  let lastLine: SourceLine | null = null;
  let n = 0;
  const add = (text: string, extra: Partial<PlanRow> = {}): PlanRow => {
    const row: PlanRow = { id: `r${++n}`, text, headings: stack.map((s) => s.text), parentId: null, number: null, paragraph: false, ...extra };
    if (stack.length === 1) mainHasRows = true;
    rows.push(row);
    return row;
  };
  /** The current main heading has rows directly under it. */
  let mainHasRows = false;
  const pushHeading = (level: number, text: string) => {
    if (level === 1) mainHasRows = false;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, text });
    listStack = [];
    last = null;
  };

  lines.forEach((line, i) => {
    if (i === titleIdx) { lastLine = line; return; }
    if (line.heading) {
      // Plain text shows no levels. A guessed sub-heading after rows of its own main heading
      // ("Vid rött", rows, "Anhöriga") starts a new main section instead of nesting under it.
      const level = line.guessed && line.heading > 1 && (!stack.length || mainHasRows) ? 1 : line.heading;
      pushHeading(level, line.text);
      lastLine = line;
      return;
    }
    const inline = inlineHeading(line);
    if (inline) {
      pushHeading(inline.level, inline.heading);
      for (const part of inline.parts) add(part);
      last = null;
      lastLine = line;
      return;
    }
    if (line.list) {
      while (listStack.length && listStack[listStack.length - 1].indent >= line.indent) listStack.pop();
      const parent = listStack[listStack.length - 1];
      last = add(line.text, { parentId: parent?.id ?? null, number: line.number });
      listStack.push({ indent: line.indent, id: last.id });
      lastLine = line;
      return;
    }
    // Running text: a line that starts in lower case continues the line before (text wrapped
    // when copied). A line in upper case is a row of its own, as in a plan written one thing per line.
    const prev: PlanRow | null = last;
    if (prev && !line.gapBefore && lastLine && !lastLine.heading && /^[a-zåäö0-9(]/.test(line.text)) {
      prev.text = `${prev.text} ${line.text}`.replace(/\s+/g, ' ');
    } else {
      last = add(line.text, { paragraph: true });
      listStack = [];
    }
    lastLine = line;
  });
  return { title, rows };
}
