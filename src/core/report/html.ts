// Plain HTML for the documents the person saves as PDF and shares themselves (Inför återbesök,
// Visa för någon, Anhörigkort). The app sends nothing; the person chooses where it goes.

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type ReportPart =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; muted?: boolean }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'table'; head: string[]; rows: string[][] };

const LEVEL_MARK: Record<string, string> = { green: '● Grönt', yellow: '▲ Gult', red: '◆ Rött' };

/** "● Grönt", "▲ Gult", "◆ Rött": the level never rests on colour alone, also on paper. */
export function levelMark(level: string | null): string {
  return level ? LEVEL_MARK[level] ?? level : '– Ingen avstämning';
}

export function reportHtml(title: string, subtitle: string, parts: ReportPart[]): string {
  const body = parts
    .map((p) => {
      switch (p.kind) {
        case 'heading': return `<h2>${esc(p.text)}</h2>`;
        case 'text': return `<p${p.muted ? ' class="muted"' : ''}>${esc(p.text)}</p>`;
        case 'list': {
          const tag = p.ordered ? 'ol' : 'ul';
          return p.items.length ? `<${tag}>${p.items.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>` : '<p class="muted">Inget.</p>';
        }
        case 'table':
          return `<table><thead><tr>${p.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${p.rows
            .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`;
      }
    })
    .join('\n');
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
body { font: 12pt/1.45 -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 24px; }
h1 { font-size: 20pt; margin: 0 0 4px; } h2 { font-size: 14pt; margin: 20px 0 6px; }
.muted, .sub { color: #555; } .sub { margin: 0 0 16px; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #ddd; font-size: 11pt; }
li { margin: 2px 0; }
</style></head><body><h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>
${body}
<p class="muted" style="margin-top:24px">Från Dagsljus, en dagbok som jämför med personens egen krisplan. Ställer ingen diagnos.</p>
</body></html>`;
}

/** "4 gröna, 0 gula, 1 röd och 9 dagar utan avstämning": singular for one. */
export function levelCounts(c: { green: number; yellow: number; red: number; none: number }): string {
  const w = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `${w(c.green, 'grön', 'gröna')}, ${w(c.yellow, 'gul', 'gula')}, ${w(c.red, 'röd', 'röda')} och ${w(c.none, 'dag', 'dagar')} utan avstämning.`;
}
