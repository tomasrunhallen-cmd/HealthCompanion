// Läget i dag on Hem, made once a day and kept: the code's facts and tone (core/plan/status.ts),
// worded by the language model when one is set up and the person has not turned it off. Made
// again, at most twice a day, when the facts change (for example after the evening's check-in).

import { addDays, eveningDateKey } from '../core/analysis/dates';
import { akutCheck } from '../core/context/akut';
import { countedRoutineIds } from '../core/plan/routines';
import { checkStatus, codeStatusText, statusFacts, TONE_TEXT, type StatusFacts, type StatusInput, type StatusTone } from '../core/plan/status';
import { loadPrompt } from '../core/prompts/loader';
import { scrub } from '../core/privacy/scrub';
import type { Repository } from '../storage/repository';
import { activeAdapter, namesToScrub, trackedCompleter, type AdapterOptions } from './llm';

export const STATUS_KEY = 'statusToday';
const NOTES = 3;
const NOTE_MAX = 200;
const MAX_REMAKES = 2;

export interface StatusToday {
  date: string;
  text: string;
  tone: StatusTone;
  facts: string[];
  method: 'llm' | 'code';
  model: string | null;
  promptVersion: string | null;
  createdAt: string;
  /** The facts it was made from, to tell when they change. */
  key: string;
  remakes: number;
}

/** On unless the person turned it off; it needs a model to word anything. */
export function statusOn(repo: Repository): boolean {
  return repo.settings().statusSummary !== false;
}

export function statusToday(repo: Repository, now = new Date()): StatusToday | null {
  const s = repo.kvGet(STATUS_KEY) as StatusToday | undefined;
  return s && s.date === eveningDateKey(now) ? s : null;
}

/** Everything the code needs, read from what is saved. */
export function statusInput(repo: Repository, now = new Date()): StatusInput {
  const today = eveningDateKey(now);
  const from = addDays(today, -27);
  const stopped = new Set(repo.assessments().filter((a) => a.akut).map((a) => a.entryId));
  const byDate = new Map<string, StatusInput['days'][number]>();
  for (const h of repo.history()) {
    if (h.entry.date < from || h.entry.date > today) continue;
    byDate.set(h.entry.date, { date: h.entry.date, level: h.level, mood: h.entry.mood, sleepHours: null, akut: stopped.has(h.entry.id) });
  }
  const measured = repo.measuredDays();
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const hours = measured[d]?.sleepHours ?? null;
    if (hours == null) continue;
    const day = byDate.get(d) ?? { date: d, level: null, mood: null, sleepHours: null, akut: false };
    byDate.set(d, { ...day, sleepHours: hours });
  }
  const ctx = repo.contextEntries();
  const ids = countedRoutineIds(ctx, repo.settings().planMode ?? null, addDays(today, -13), today);
  const routineText = new Map(ctx.filter((e) => e.kind === 'routine').map((e) => [e.id, e.text]));
  const answers = ctx.filter((e) => e.kind === 'routine_done' && e.date && e.date >= addDays(today, -13) && e.date <= today && e.done != null);
  return {
    today,
    days: [...byDate.values()],
    routines: ids.map((id) => ({ id, text: routineText.get(id) ?? '' })).filter((r) => r.text),
    ticks: answers.filter((e) => e.done && e.routineId).map((e) => ({ date: e.date!, routineId: e.routineId! })),
    answeredDates: answers.map((e) => e.date!),
    events: ctx.filter((e) => e.kind === 'event' && e.date).map((e) => ({ date: e.date!, text: e.text })),
    upward: repo.settings().planMode?.direction === 'up',
  };
}

/** The week's notes for the tone of the words: the newest few, short, never one the emergency rule would stop. */
function notesText(repo: Repository, today: string): string {
  const stopped = new Set(repo.assessments().filter((a) => a.akut || a.akutMild).map((a) => a.entryId));
  const own = repo.contextOf('akut').map((e) => e.text);
  const notes = repo.entries()
    .filter((e) => e.date > addDays(today, -7) && e.date <= today && e.transcript.trim() && !stopped.has(e.id) && !akutCheck(e.transcript, own).level)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, NOTES)
    .map((e) => `- ${e.transcript.trim().replace(/\s+/g, ' ').slice(0, NOTE_MAX)}`);
  return notes.length ? notes.join('\n') : '(inga anteckningar)';
}

/** Makes today's text, or makes it again when the facts changed. Never throws: a model that fails leaves the code's words. */
export async function makeStatus(repo: Repository, opts: AdapterOptions & { force?: boolean } = {}, now = new Date()): Promise<StatusToday> {
  const existing = statusToday(repo, now);
  const facts: StatusFacts = statusFacts(statusInput(repo, now));
  const key = JSON.stringify([facts.tone, facts.lines]);
  if (existing && !opts.force && (existing.key === key || existing.remakes >= MAX_REMAKES)) return existing;
  const today = eveningDateKey(now);
  const base: StatusToday = {
    date: today, text: codeStatusText(facts), tone: facts.tone, facts: facts.lines, method: 'code', model: null, promptVersion: null,
    createdAt: now.toISOString(), key, remakes: existing ? existing.remakes + 1 : 0,
  };
  let result = base;
  if (facts.tone !== 'plan' && statusOn(repo)) {
    try {
      const adapter = await activeAdapter(repo, opts);
      if (adapter) {
        const names = namesToScrub(repo);
        const clean = (t: string) => scrub(t, names).text;
        const prompt = loadPrompt('lagesbild');
        const res = await trackedCompleter(repo, adapter, opts.now).complete(prompt, {
          ton: TONE_TEXT[facts.tone],
          fakta: clean(facts.lines.map((l) => `- ${l}`).join('\n')),
          anteckningar: clean(notesText(repo, today)),
        });
        const text = checkStatus(res.json, facts);
        if (text) result = { ...base, text, method: 'llm', model: adapter.model, promptVersion: String(prompt.meta.version) };
      }
    } catch {
      // The code's words stand.
    }
  }
  await repo.kvSet(STATUS_KEY, result);
  return result;
}
