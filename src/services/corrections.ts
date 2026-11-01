// Saving a correction and deciding a proposal: the parts of the corrections that write to
// the database. The rules for when a proposal is made are in context/corrections.ts.

import { suggestionsFromCorrections } from '../core/context/corrections';
import type { Assessment, ContextEntry, Suggestion } from '../core/domain/types';
import type { Repository } from '../storage/repository';

export interface CorrectionInput {
  verdict: 'agree' | 'disagree';
  /** Signs the verdict is about. Empty: about the assessment as a whole. */
  planItemIds: string[];
  text: string;
}

/** Saves the user's correction of one assessment, replacing an earlier one, and proposes changes. */
export async function saveCorrection(repo: Repository, a: Assessment, input: CorrectionInput, now = new Date()): Promise<Suggestion[]> {
  for (const old of repo.contextOf('correction').filter((c) => c.correction?.assessmentId === a.id)) {
    await repo.removeContextEntry(old.id, false);
  }
  const ids = input.planItemIds.length ? input.planItemIds : [null];
  for (const planItemId of ids) {
    await repo.addContextEntry({
      kind: 'correction',
      text: input.text.trim(),
      origin: 'correction',
      date: a.date,
      createdAt: now.toISOString(),
      correction: { assessmentId: a.id, verdict: input.verdict, planItemId },
    }, false);
  }
  const fresh = suggestionsFromCorrections(repo.contextOf('correction'), repo.plan(), repo.suggestions(), now);
  await repo.saveSuggestions([...repo.suggestions(), ...fresh]);
  return fresh;
}

export function correctionFor(repo: Repository, assessmentId: string): ContextEntry[] {
  return repo.contextOf('correction').filter((c) => c.correction?.assessmentId === assessmentId);
}

/** Approving is the only way a proposal reaches the context bank. */
export async function decideSuggestion(
  repo: Repository,
  id: string,
  approve: boolean,
  editedText?: string,
  now = new Date(),
): Promise<void> {
  const s = repo.suggestions().find((x) => x.id === id);
  if (!s || s.status !== 'pending') return;
  if (approve) {
    const text = (editedText ?? s.change.text).trim();
    const stamp = now.toISOString();
    if (s.change.action === 'add') {
      await repo.addContextEntry({ kind: s.change.kind, text, origin: 'suggested', approvedAt: stamp }, false);
    } else if (s.change.action === 'update' && s.change.targetId) {
      await repo.updateContextEntry(s.change.targetId, { text, origin: 'suggested', approvedAt: stamp }, false);
    } else if (s.change.action === 'remove' && s.change.targetId) {
      await repo.removeContextEntry(s.change.targetId, false);
    } else if (s.change.action === 'confirm' && s.change.targetId) {
      await repo.updateContextEntry(s.change.targetId, { origin: 'user', approvedAt: stamp }, false);
    }
  }
  await repo.saveSuggestions(
    repo.suggestions().map((x) => (x.id === id ? { ...x, status: approve ? 'approved' : 'rejected', decidedAt: now.toISOString() } : x)),
  );
}
