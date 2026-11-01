// Inför återbesök: the summary from the database, the person's own list of things to bring up,
// and the PDF the person saves and shares themselves.

import { newId } from '../core/analysis/assess';
import { eveningDateKey, formatDateSv } from '../core/analysis/dates';
import { buildVisitSummary, type VisitSummary, type VisitTopic } from '../core/analysis/visit';
import { levelMark, reportHtml, type ReportPart } from '../core/report/html';
import { polarityWord } from '../core/plan/fields';
import type { PlanSettings } from '../core/domain/types';
import type { Repository } from '../storage/repository';

export const TOPICS_KEY = 'visitTopics';

export function visitTopics(repo: Repository): VisitTopic[] {
  return (repo.kvGet(TOPICS_KEY) as VisitTopic[] | undefined) ?? [];
}

export async function addVisitTopic(repo: Repository, text: string, now = new Date()): Promise<void> {
  if (!text.trim()) return;
  await repo.kvSet(TOPICS_KEY, [...visitTopics(repo), { id: newId('t'), text: text.trim(), createdAt: now.toISOString() }]);
}

export async function removeVisitTopic(repo: Repository, id: string): Promise<void> {
  await repo.kvSet(TOPICS_KEY, visitTopics(repo).filter((t) => t.id !== id));
}

export function visitSummary(repo: Repository, days: 14 | 30, now = new Date()): VisitSummary {
  return buildVisitSummary({
    today: eveningDateKey(now),
    days,
    entries: repo.entries(),
    assessments: repo.assessments(),
    context: repo.contextEntries(),
    plan: repo.plan(),
    measured: repo.allMeasuredDays(),
    topics: visitTopics(repo),
  });
}

const dec = (n: number | null) => (n == null ? '–' : String(n).replace('.', ','));

export function visitHtml(s: VisitSummary, ps: Pick<PlanSettings, 'polarityWords'>): string {
  const word = (d: 'up' | 'down') => polarityWord(d, ps);
  const sign = (list: { text: string; days: number }[]) => list.map((x) => `${x.text} (${x.days} ${x.days === 1 ? 'dag' : 'dagar'})`);
  const parts: ReportPart[] = [
    { kind: 'heading', text: 'Saker jag vill ta upp' },
    { kind: 'list', items: s.topics.map((t) => t.text) },
    { kind: 'heading', text: 'Nivå per dag' },
    { kind: 'text', text: `${s.counts.green} gröna, ${s.counts.yellow} gula, ${s.counts.red} röda och ${s.counts.none} dagar utan avstämning.` },
    { kind: 'table', head: ['Dag', 'Nivå', 'Sömn (h)', 'Stress'], rows: s.days.map((d) => [formatDateSv(d.date), levelMark(d.level), dec(d.sleepHours), dec(d.stressAvg)]) },
    { kind: 'text', text: `Snitt: sömn ${dec(s.sleepAvg)} h, stress ${dec(s.stressAvg)}.`, muted: true },
    { kind: 'heading', text: `Tecken som syntes, ${word('up')}` },
    { kind: 'list', items: sign(s.signs.up) },
    { kind: 'heading', text: `Tecken som syntes, ${word('down')}` },
    { kind: 'list', items: sign(s.signs.down) },
  ];
  if (s.signs.both.length) parts.push({ kind: 'heading', text: 'Tecken som syntes, utan riktning' }, { kind: 'list', items: sign(s.signs.both) });
  if (s.redSteps.length) {
    parts.push({ kind: 'heading', text: 'Stegen efter röda dagar' });
    for (const r of s.redSteps) parts.push({ kind: 'text', text: formatDateSv(r.date) }, { kind: 'list', items: r.steps.map((x) => `${x.done ? 'Gjort' : 'Inte gjort'}: ${x.text}`) });
  }
  parts.push({ kind: 'heading', text: 'Rutiner' }, { kind: 'list', items: s.routines.map((r) => `${r.text}: ${r.done} av ${r.logged} dagar`) });
  return reportHtml('Inför återbesök', `${formatDateSv(s.from)} – ${formatDateSv(s.to)}`, parts);
}
