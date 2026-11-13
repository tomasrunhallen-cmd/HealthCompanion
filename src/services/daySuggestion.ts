// The day's routine suggestion on Hem, made once a day and kept: the code's candidates, chosen
// and worded by the language model when one is set up and the person has not turned it off,
// else the code's own order. See core/plan/daySuggestion.ts for what is sent and checked.

import { addDays, eveningDateKey } from '../core/analysis/dates';
import { checkSuggestion, codeSuggestion, suggestionInput, type DaySuggestion } from '../core/plan/daySuggestion';
import { routineStatuses, weekday } from '../core/plan/routineFrequency';
import { loadPrompt } from '../core/prompts/loader';
import type { Repository } from '../storage/repository';
import { activeAdapter, namesToScrub, trackedCompleter, type AdapterOptions } from './llm';

export const DAY_SUGGESTION_KEY = 'daySuggestion';

export function daySuggestion(repo: Repository, now = new Date()): DaySuggestion | null {
  const s = repo.kvGet(DAY_SUGGESTION_KEY) as DaySuggestion | undefined;
  return s && s.date === eveningDateKey(now) ? s : null;
}

/** On unless the person turned it off; it needs a model to word anything. */
export function modelSuggestionsOn(repo: Repository): boolean {
  return repo.settings().routineSuggestions !== false;
}

/** Makes today's suggestion, unless there is one. Never throws: a model that fails leaves the code's. */
export async function makeDaySuggestion(repo: Repository, opts: AdapterOptions & { force?: boolean } = {}, now = new Date()): Promise<DaySuggestion> {
  const existing = daySuggestion(repo, now);
  if (existing && !opts.force) return existing;
  const today = eveningDateKey(now);
  const statuses = routineStatuses(repo.contextEntries(), today);
  const base: DaySuggestion = { date: today, items: codeSuggestion(statuses, today), method: 'code', model: null, promptVersion: null, createdAt: now.toISOString() };
  let result = base;
  if (base.items.length && modelSuggestionsOn(repo)) {
    try {
      const adapter = await activeAdapter(repo, opts);
      if (adapter) {
        const yesterday = repo.entryFor(addDays(today, -1));
        const input = suggestionInput(statuses, {
          today,
          weekday: weekday(today),
          yesterdayLevel: yesterday ? repo.assessmentFor(yesterday.id)?.level ?? null : null,
          sleepHours: repo.measuredDay(today)?.sleepHours ?? null,
          sleepLimit: repo.planSettings().sleepThresholdHours,
        }, namesToScrub(repo));
        const prompt = loadPrompt('dagsforslag');
        const res = await trackedCompleter(repo, adapter, opts.now).complete(prompt, input.variables);
        const items = checkSuggestion(res.json, input);
        if (items) result = { ...base, items, method: 'llm', model: adapter.model, promptVersion: String(prompt.meta.version) };
      }
    } catch {
      // The code's suggestion stands.
    }
  }
  await repo.kvSet(DAY_SUGGESTION_KEY, result);
  return result;
}
