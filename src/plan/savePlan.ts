// Saves the approved rows of a reviewed plan in the context bank, each with its fields.
// Emergency rows become the person's own emergency phrases; normalläge goes to the plan
// settings. Removed headers and the draft itself are never saved.

import { newId } from '../analysis/assess';
import type { Repository } from '../storage/repository';
import type { PlanDraft } from './importPlan';
import { contextKindOf, normalizeFields } from './fields';

export interface SaveSummary {
  saved: number;
  akut: number;
  normal: number;
}

export async function saveApprovedRows(repo: Repository, draft: PlanDraft): Promise<SaveSummary> {
  const sum: SaveSummary = { saved: 0, akut: 0, normal: 0 };
  const normal: string[] = [];
  for (const r of draft.rows) {
    const text = r.text.trim();
    if (!r.approved || !text || r.fields.kind === 'ignore') continue;
    if (r.akut) {
      await repo.addContextEntry({ id: newId('p'), kind: 'akut', text, origin: 'crisis_plan' }, false);
      sum.akut++;
      continue;
    }
    if (r.special === 'normal') {
      normal.push(text);
      sum.normal++;
      continue;
    }
    const fields = normalizeFields({ ...r.fields, sourceHeading: r.heading || undefined });
    const kind = contextKindOf(fields);
    if (!kind) continue;
    await repo.addContextEntry({ id: newId('p'), kind, text, origin: 'crisis_plan', plan: fields }, false);
    sum.saved++;
  }
  const patch: Parameters<Repository['updatePlanSettings']>[0] = {};
  if (normal.length) patch.normalState = [repo.planSettings().normalState.trim(), ...normal].filter(Boolean).join('. ');
  // The plan's own words for the directions, only when its headings use them.
  if (draft.polarityWords.up || draft.polarityWords.down) {
    patch.polarityWords = { ...repo.planSettings().polarityWords, ...draft.polarityWords };
  }
  if (Object.keys(patch).length) await repo.updatePlanSettings(patch);
  await repo.kvSet('planImportDraft', null);
  return sum;
}
