// Profile update and course. Once a month, and when a period with yellow or red for
// more than three days is over, the app proposes changes to the profil layer from the
// user's scrubbed notes (prompts/profil-uppdatering.md), and a course of the period
// computed in code from the assessments. Everything becomes proposals; nothing is
// written to the context bank until the user approves it.

import { addDays, daysBetween, formatDateSv } from '../analysis/dates';
import { normalize } from '../analysis/wordmatch';
import type { Completer } from '../adapter/types';
import type { Assessment, ContextEntry, ContextKind, DateKey, Entry, PlanItem, Suggestion } from '../domain/types';
import { loadPrompt } from '../prompts/loader';
import { scrub } from '../privacy/scrub';

export const MONTH_DAYS = 30;
/** "mer än tre dagar" */
export const PERIOD_MIN_DAYS = 4;

export interface Period {
  from: DateKey;
  to: DateKey;
}

export interface ProfileUpdateState {
  lastRunAt: string | null;
  /** End date of the last period already reviewed. */
  lastPeriodEnd: DateKey | null;
}

export const DEFAULT_PROFILE_STATE: ProfileUpdateState = { lastRunAt: null, lastPeriodEnd: null };

/** Runs of consecutive days with yellow or red, longer than three days, that have ended. */
export function endedPeriods(assessments: Assessment[], today: DateKey): Period[] {
  const nonGreen = new Set(assessments.filter((a) => a.level !== 'green').map((a) => a.date));
  const green = new Set(assessments.filter((a) => a.level === 'green').map((a) => a.date));
  const dates = Array.from(nonGreen).sort();
  const out: Period[] = [];
  let start: DateKey | null = null;
  let prev: DateKey | null = null;
  const close = () => {
    if (start && prev && daysBetween(start, prev) + 1 >= PERIOD_MIN_DAYS) {
      // Over when a green day follows, or when the last day was before today.
      const after = addDays(prev, 1);
      if (green.has(after) || prev < addDays(today, -1)) out.push({ from: start, to: prev });
    }
  };
  for (const d of dates) {
    if (prev && d === addDays(prev, 1)) {
      prev = d;
      continue;
    }
    close();
    start = d;
    prev = d;
  }
  close();
  return out;
}

export type Due = { reason: 'period'; period: Period } | { reason: 'monthly'; period: Period } | null;

export function profileUpdateDue(state: ProfileUpdateState, assessments: Assessment[], now: Date, today: DateKey): Due {
  const period = endedPeriods(assessments, today).filter((p) => !state.lastPeriodEnd || p.to > state.lastPeriodEnd).pop();
  if (period) return { reason: 'period', period };
  const first = assessments.map((a) => a.date).sort()[0];
  if (!first) return null;
  const since = state.lastRunAt ? state.lastRunAt.slice(0, 10) : first;
  if (daysBetween(since, today) >= MONTH_DAYS) return { reason: 'monthly', period: { from: addDays(today, -MONTH_DAYS), to: today } };
  return null;
}

let n = 0;
function sid(): string {
  n = (n + 1) % 1_000_000;
  return `p_${Date.now().toString(36)}_${n.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The course of a period, from the assessments: which sign came first and how many days
 * passed until the next one. Code only. Null when fewer than two signs appeared.
 */
export function courseOfPeriod(period: Period, assessments: Assessment[], plan: PlanItem[]): string | null {
  const firstSeen = new Map<string, DateKey>();
  for (const a of assessments.filter((x) => x.date >= period.from && x.date <= period.to).sort((x, y) => x.date.localeCompare(y.date))) {
    for (const s of a.signals) {
      if ((s.kind === 'early_sign' || s.kind === 'serious_sign') && s.planItemId && !firstSeen.has(s.planItemId)) {
        firstSeen.set(s.planItemId, a.date);
      }
    }
  }
  const order = Array.from(firstSeen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  if (order.length < 2) return null;
  const name = (id: string) => plan.find((p) => p.id === id)?.text ?? 'ett tecken';
  const parts = [`först ”${name(order[0][0])}”`];
  for (let i = 1; i < order.length; i++) {
    const gap = daysBetween(order[i - 1][1], order[i][1]);
    parts.push(gap === 0 ? `samma dag ”${name(order[i][0])}”` : `${gap} ${gap === 1 ? 'dag' : 'dagar'} senare ”${name(order[i][0])}”`);
  }
  return `Perioden ${formatDateSv(period.from)} till ${formatDateSv(period.to)}: ${parts.join(', ')}.`;
}

export function courseSuggestion(text: string, period: Period, now: Date): Suggestion {
  return {
    id: sid(), key: `course:${period.from}:${period.to}`, type: 'course', status: 'pending', createdAt: now.toISOString(), decidedAt: null,
    source: 'profile_update', change: { action: 'add', kind: 'course', text },
    reason: 'Så här utvecklades perioden enligt dina bedömningar. Räknat i appen ur vilka tecken som matchade och när.',
    quotes: [],
  };
}

const KIND_FROM_PROMPT: Record<string, ContextKind> = {
  normallage: 'normal_state',
  'typisk-formulering': 'typical_phrase',
  'period-nedstamd': 'period_low',
  'period-uppvarvad': 'period_high',
  'period-blandad': 'period_mixed',
};

const PROFILE_KINDS: ContextKind[] = ['normal_state', 'typical_phrase', 'period_low', 'period_high', 'period_mixed', 'course'];
const DIAGNOSIS = /\b(mani\w*|hypomani\w*|depression\w*|depressiv\w*|episod\w*|bipolär\w*|psykos\w*)\b/i;

export interface ProfileInput {
  reason: string;
  normalState: string;
  signs: PlanItem[];
  profile: ContextEntry[];
  /** Notes in the window, with their dates and levels. Emergency notes are left out. */
  notes: { date: DateKey; level: string; text: string }[];
  names: string[];
}

export function profileVariables(input: ProfileInput): Record<string, string> {
  const clean = (t: string) => scrub(t, input.names).text;
  const profile = input.profile.filter((e) => PROFILE_KINDS.includes(e.kind));
  return {
    anledning: input.reason,
    normallage: clean(input.normalState || '(inte ifyllt)'),
    tecken: clean(input.signs.map((s) => `- ${s.text}`).join('\n') || '(inga)'),
    profil: clean(profile.map((e, i) => `${i + 1}. [${e.kind}] ${e.text}`).join('\n') || '(tom)'),
    anteckningar: clean(input.notes.map((x) => `- ${formatDateSv(x.date)} (${x.level}): ${x.text}`).join('\n') || '(inga anteckningar)'),
  };
}

interface Answer {
  changes: { action: 'add' | 'update' | 'remove'; kind: string; target: number; text: string; reason: string; quotes: string[] }[];
}

/**
 * Turns the model's answer into proposals. Drops anything without a quote that really is
 * in the notes, any diagnosis word the plan does not use, and targets that do not exist.
 */
export function suggestionsFromAnswer(answer: Answer, input: ProfileInput, scrubbedNotes: string, now: Date): Suggestion[] {
  const notes = normalize(scrubbedNotes);
  const planText = input.signs.map((s) => s.text).join(' ');
  const profile = input.profile.filter((e) => PROFILE_KINDS.includes(e.kind));
  const out: Suggestion[] = [];
  for (const c of answer.changes) {
    const kind = KIND_FROM_PROMPT[c.kind];
    if (!kind) continue;
    const quotes = c.quotes.filter((q) => q.trim() && notes.includes(normalize(q)));
    if (!quotes.length) continue;
    if (DIAGNOSIS.test(c.text) && !DIAGNOSIS.test(planText)) continue;
    const target = c.target > 0 ? profile[c.target - 1] : undefined;
    if (c.action !== 'add' && !target) continue;
    out.push({
      id: sid(),
      key: `profile:${c.action}:${target?.id ?? normalize(c.text).slice(0, 60)}`,
      type: 'profile',
      status: 'pending',
      createdAt: now.toISOString(),
      decidedAt: null,
      source: 'profile_update',
      change: { action: c.action, kind: target?.kind ?? kind, text: c.action === 'remove' ? target!.text : c.text, targetId: target?.id ?? null },
      reason: c.reason,
      quotes,
    });
  }
  return out;
}

export async function askModelForProfile(completer: Completer, input: ProfileInput, now: Date): Promise<Suggestion[]> {
  const vars = profileVariables(input);
  const res = await completer.complete(loadPrompt('profil-uppdatering'), vars);
  return suggestionsFromAnswer(res.json as Answer, input, vars.anteckningar, now);
}

/** Notes for the window, without notes that triggered the emergency rule. */
export function notesForWindow(entries: Entry[], assessments: Assessment[], period: Period): ProfileInput['notes'] {
  const levelText: Record<string, string> = { green: 'grönt', yellow: 'gult', red: 'rött' };
  return entries
    .filter((e) => e.date >= period.from && e.date <= period.to && e.transcript.trim())
    .map((e) => ({ e, a: assessments.find((a) => a.entryId === e.id) }))
    .filter(({ a }) => !a?.akut)
    .map(({ e, a }) => ({ date: e.date, level: a ? levelText[a.level] : 'okänt', text: e.transcript }));
}
