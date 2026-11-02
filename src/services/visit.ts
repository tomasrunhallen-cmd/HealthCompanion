// Inför återbesök: the summary from the database, the person's own list of things to bring up,
// and the PDF the person saves and shares themselves.

import { moodText } from '../core/analysis/mood';
import { newId } from '../core/analysis/assess';
import { eveningDateKey, formatDateSv } from '../core/analysis/dates';
import { buildVisitSummary, LEVEL_DISCLAIMER, type VisitSummary, type VisitTopic } from '../core/analysis/visit';
import { levelCounts, levelMark, reportHtml, type ReportPart } from '../core/report/html';
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

export function visitSummary(repo: Repository, days: number, now = new Date()): VisitSummary {
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

export interface ShareChoice {
  levels: boolean;
  sleepStress: boolean;
  signs: boolean;
}

/**
 * Visa för någon: only what the person chose, from the period they chose. Never the notes,
 * never the list of things to bring up, never routines or answers after red days.
 */
export function shareHtml(s: VisitSummary, choice: ShareChoice, ps: Pick<PlanSettings, 'polarityWords'>): string {
  const parts: ReportPart[] = [];
  if (choice.levels) {
    parts.push(
      { kind: 'heading', text: 'Ampeln per dag' },
      { kind: 'text', text: levelCounts(s.counts) },
      { kind: 'text', text: LEVEL_DISCLAIMER, muted: true },
    );
  }
  if (choice.levels || choice.sleepStress) {
    const head = ['Dag', ...(choice.levels ? ['Nivå'] : []), ...(choice.sleepStress ? ['Sömn (h)', 'Stress'] : [])];
    parts.push({ kind: 'table', head, rows: s.days.map((d) => [formatDateSv(d.date), ...(choice.levels ? [levelMark(d.level)] : []), ...(choice.sleepStress ? [dec(d.sleepHours), dec(d.stressAvg)] : [])]) });
  }
  if (choice.sleepStress) parts.push({ kind: 'text', text: `Snitt: sömn ${dec(s.sleepAvg)} h, stress ${dec(s.stressAvg)}.`, muted: true });
  if (choice.signs) {
    const sign = (list: { text: string; days: number }[]) => list.map((x) => `${x.text} (${x.days} ${x.days === 1 ? 'dag' : 'dagar'})`);
    parts.push(
      { kind: 'heading', text: `Tecken som syntes, ${polarityWord('up', ps)}` }, { kind: 'list', items: sign(s.signs.up) },
      { kind: 'heading', text: `Tecken som syntes, ${polarityWord('down', ps)}` }, { kind: 'list', items: sign(s.signs.down) },
    );
    if (s.signs.both.length) parts.push({ kind: 'heading', text: 'Tecken som syntes, utan riktning' }, { kind: 'list', items: sign(s.signs.both) });
  }
  return reportHtml('Så har jag haft det', `${formatDateSv(s.from)} – ${formatDateSv(s.to)}. Utan anteckningar.`, parts);
}

export function visitHtml(s: VisitSummary, ps: Pick<PlanSettings, 'polarityWords'>): string {
  const word = (d: 'up' | 'down') => polarityWord(d, ps);
  const sign = (list: { text: string; days: number }[]) => list.map((x) => `${x.text} (${x.days} ${x.days === 1 ? 'dag' : 'dagar'})`);
  const parts: ReportPart[] = [
    { kind: 'heading', text: 'Saker jag vill ta upp' },
    { kind: 'list', items: s.topics.map((t) => t.text) },
    { kind: 'heading', text: 'Dag för dag' },
    { kind: 'text', text: levelCounts(s.counts) },
    { kind: 'text', text: LEVEL_DISCLAIMER, muted: true },
    {
      kind: 'table',
      head: ['Dag', 'Nivå', 'Stämning', 'Sömn (h)', 'Stress', 'Riktning', 'Anmärkning'],
      rows: s.days.map((d) => [
        formatDateSv(d.date), levelMark(d.level), d.mood != null ? moodText(d.mood) : '–', dec(d.sleepHours), dec(d.stressAvg),
        d.direction === 'both' ? 'båda' : d.direction ? word(d.direction) : '–', d.notes.join(', ') || '',
      ]),
    },
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
