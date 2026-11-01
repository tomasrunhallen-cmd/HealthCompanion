// Corrections after an assessment ("Stämmer" / "Stämmer inte") and the proposals they
// lead to. Three corrections in the same direction about the same sign give exactly one
// proposal. Nothing reaches the context bank until the user approves it. Pure: saving and
// deciding live in services/corrections.ts.

import { formatDateSv } from '../analysis/dates';
import type { Assessment, ContextEntry, PlanItem, Suggestion } from '../domain/types';

export const CORRECTIONS_FOR_SUGGESTION = 3;

let n = 0;
function sid(): string {
  n = (n + 1) % 1_000_000;
  return `s_${Date.now().toString(36)}_${n.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * New proposals from the corrections. Counts only corrections made after the last
 * decision on the same proposal, and never adds one while the same one is pending.
 */
export function suggestionsFromCorrections(
  corrections: ContextEntry[],
  plan: PlanItem[],
  existing: Suggestion[],
  now = new Date(),
): Suggestion[] {
  const out: Suggestion[] = [];
  const groups = new Map<string, ContextEntry[]>();
  for (const c of corrections) {
    const id = c.correction?.planItemId;
    if (!id || !c.correction) continue;
    const key = `${c.correction.verdict === 'disagree' ? 'false_alarm' : 'own_sign'}:${id}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const [key, list] of groups) {
    const [type, signId] = key.split(':') as ['false_alarm' | 'own_sign', string];
    const sign = plan.find((p) => p.id === signId);
    if (!sign) continue;
    const same = existing.filter((s) => s.key === key);
    if (same.some((s) => s.status === 'pending')) continue;
    const lastDecision = same.map((s) => s.decidedAt ?? '').sort().pop() ?? '';
    const fresh = list.filter((c) => c.createdAt > lastDecision).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (fresh.length < CORRECTIONS_FOR_SUGGESTION) continue;
    // "Gör till eget tecken?" only makes sense for standard rows not yet confirmed.
    if (type === 'own_sign' && !(sign.origin === 'standard' && sign.approvedAt == null)) continue;
    const days = fresh.map((c) => (c.date ? formatDateSv(c.date) : '')).filter(Boolean).join(', ');
    const notes = fresh.map((c) => c.text.trim()).filter(Boolean);
    out.push(
      type === 'false_alarm'
        ? {
            id: sid(), key, type, status: 'pending', createdAt: now.toISOString(), decidedAt: null, source: 'corrections',
            change: { action: 'add', kind: 'false_alarm', text: notes.length ? `${sign.text}: ${notes[notes.length - 1]}` : `${sign.text} betyder ofta inget för mig` },
            reason: `Du har sagt att tecknet ”${sign.text}” inte stämde ${fresh.length} gånger${days ? ` (${days})` : ''}. Lägg till som känt falsklarm?`,
            quotes: notes,
          }
        : {
            id: sid(), key, type, status: 'pending', createdAt: now.toISOString(), decidedAt: null, source: 'corrections',
            change: { action: 'confirm', kind: sign.kind, text: sign.text, targetId: sign.id },
            reason: `Standardtecknet ”${sign.text}” har stämt ${fresh.length} gånger${days ? ` (${days})` : ''}. Gör till eget tecken? Då kan det också bidra till rött.`,
            quotes: notes,
          },
    );
  }
  return out;
}
