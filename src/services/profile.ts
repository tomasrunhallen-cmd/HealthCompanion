// Runs a profile review: the course of an ended period (code) and proposed profile
// changes from the scrubbed notes (language model, when one is set up). All results are
// proposals the user approves or rejects one at a time.

import { eveningDateKey, addDays, toDateKey } from '../core/analysis/dates';
import {
  askModelForProfile, courseOfPeriod, courseSuggestion, DEFAULT_PROFILE_STATE, notesForWindow, profileUpdateDue,
  type Due, type ProfileUpdateState,
} from '../core/context/profileUpdate';
import type { Repository } from '../storage/repository';
import { activeAdapter, namesToScrub, trackedCompleter, type AdapterOptions } from './llm';

export function profileState(repo: Repository): ProfileUpdateState {
  return { ...DEFAULT_PROFILE_STATE, ...(repo.kvGet('profileUpdate') as Partial<ProfileUpdateState> | undefined) };
}

export function dueNow(repo: Repository, now = new Date()): Due {
  return profileUpdateDue(profileState(repo), repo.assessments(), now, eveningDateKey(now));
}

export interface ReviewResult {
  made: number;
  usedModel: boolean;
  error: string | null;
}

export async function runProfileReview(repo: Repository, due: NonNullable<Due>, opts: Omit<AdapterOptions, 'now'> & { at?: Date } = {}): Promise<ReviewResult> {
  const now = opts.at ?? new Date();
  const existing = repo.suggestions();
  const fresh = [];

  if (due.reason === 'period') {
    const text = courseOfPeriod(due.period, repo.assessments(), repo.plan());
    const s = text ? courseSuggestion(text, due.period, now) : null;
    if (s && !existing.some((x) => x.key === s.key)) fresh.push(s);
  }

  // A few days around a period, so the turn into and out of it is included.
  const window = due.reason === 'period'
    ? { from: addDays(due.period.from, -3), to: addDays(due.period.to, 3) }
    : due.period;
  const notes = notesForWindow(repo.entries(), repo.assessments(), window);
  let usedModel = false;
  let error: string | null = null;
  const adapter = await activeAdapter(repo, { fetch: opts.fetch, browser: opts.browser });
  if (adapter && notes.length) {
    try {
      const made = await askModelForProfile(trackedCompleter(repo, adapter, () => now), {
        reason: due.reason === 'period'
          ? 'En period med gult eller rött i mer än tre dagar är över.'
          : 'Månadens genomgång.',
        normalState: repo.planSettings().normalState,
        signs: repo.plan().filter((p) => p.kind === 'early' || p.kind === 'serious'),
        profile: repo.contextEntries('profil'),
        notes,
        names: namesToScrub(repo),
      }, now);
      usedModel = true;
      fresh.push(...made.filter((s) => !existing.some((x) => x.key === s.key && x.status === 'pending')));
    } catch (e) {
      error = (e as Error).message || 'Språkmodellen svarade inte.';
    }
  }

  await repo.saveSuggestions([...existing, ...fresh]);
  if (!error) {
    await repo.kvSet('profileUpdate', {
      lastRunAt: now.toISOString(),
      lastPeriodEnd: due.reason === 'period' ? due.period.to : profileState(repo).lastPeriodEnd,
    } satisfies ProfileUpdateState);
  }
  return { made: fresh.length, usedModel, error };
}

/** A review on request, over the last month. */
export function monthlyDue(now = new Date()): NonNullable<Due> {
  const today = toDateKey(now);
  return { reason: 'monthly', period: { from: addDays(today, -30), to: today } };
}
