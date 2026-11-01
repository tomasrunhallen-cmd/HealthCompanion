// The crisis plan's text blocks in the database. Saving a block makes its rows again, one per
// line: a row whose text is unchanged keeps its id, so a routine keeps its reminder and its
// history of ticks, and a sign keeps its corrections. Rows from other origins (standard
// content, the person's own additions elsewhere) are never touched.

import { blockLines, emptyPlan, orderBlocks, rowsFromBlock, type PlanBlock } from '../core/plan/blocks';
import { contextKindOf } from '../core/plan/fields';
import { sleepWindowIn } from '../core/plan/importPlan';
import type { ContextEntry, ContextKind } from '../core/domain/types';
import type { Repository } from '../storage/repository';

export const BLOCKS_KEY = 'planBlocks';

/** The saved blocks; a plan saved as rows before blocks existed is shown as blocks by its headings. */
export function planBlocks(repo: Repository): PlanBlock[] {
  const saved = repo.kvGet(BLOCKS_KEY) as PlanBlock[] | null | undefined;
  const blocks = saved?.length ? saved : blocksFromSavedRows(repo.contextEntries('grund'));
  // Every heading of the template is always there, empty if the plan has nothing under it.
  const missing = emptyPlan().filter((t) => !blocks.some((b) => b.type === t.type));
  // Mitt normalläge is the profile's normal state, also when it was written elsewhere.
  const normalState = repo.planSettings().normalState;
  return orderBlocks([...blocks, ...missing]).map((b) => (b.type === 'normal' && !b.text.trim() && normalState ? { ...b, text: normalState } : b));
}

export const ORIGINAL_KEY = 'planOriginal';

/** The plan as it was read in, page headers removed: shown so the person can always read the original. */
export interface PlanOriginal {
  text: string;
  sourceName: string | null;
  at: string;
}

export function planOriginal(repo: Repository): PlanOriginal | null {
  return (repo.kvGet(ORIGINAL_KEY) as PlanOriginal | null | undefined) ?? null;
}

/** Blocks from rows saved before blocks existed, grouped by kind and the plan's heading. */
function blocksFromSavedRows(entries: ContextEntry[]): PlanBlock[] {
  const blocks = emptyPlan();
  const byType = new Map(blocks.map((b) => [b.type, b]));
  const typeOf = (e: ContextEntry): PlanBlock['type'] | null => {
    const f = e.plan;
    switch (e.kind) {
      case 'early': return f?.polarity === 'up' ? 'early_up' : f?.polarity === 'down' ? 'early_down' : 'early';
      case 'serious': return f?.polarity === 'up' ? 'serious_up' : f?.polarity === 'down' ? 'serious_down' : 'serious';
      case 'action_yellow': return 'action_early';
      case 'action_red': return f?.order != null ? 'ladder' : 'action_serious';
      case 'relatives': return f?.order != null ? 'ladder' : f?.when === 'serious' ? 'others_serious' : 'relatives_early';
      case 'routine': return f?.polarity === 'up' ? 'routine_up' : f?.polarity === 'down' ? 'routine_down' : 'routine';
      case 'trigger': return 'trigger';
      case 'value_anchor': return 'value_anchor';
      case 'contact': return 'contacts';
      case 'wish': return 'wishes';
      case 'note_for_care': return 'care';
      default: return null;
    }
  };
  for (const e of entries.filter((x) => x.origin !== 'standard').sort((a, b) => a.order - b.order)) {
    const type = typeOf(e);
    if (!type) continue;
    let b = byType.get(type);
    if (!b) {
      b = { id: `b_${type}`, type, heading: e.plan?.sourceHeading?.split(' > ').join(' – ') || type, text: '', updatedAt: e.createdAt };
      blocks.push(b);
      byType.set(type, b);
    }
    b.text = b.text ? `${b.text}\n${e.text}` : e.text;
  }
  return orderBlocks(blocks);
}

export interface SaveBlocksResult {
  rows: number;
  /** A sleep window found in the routines, for the sleep rule, when the person has not chosen one. */
  sleepWindow: { start: string; end: string; text: string } | null;
}

/** Saves all blocks and makes their rows again. */
export async function savePlanBlocks(repo: Repository, blocks: PlanBlock[], now = new Date()): Promise<SaveBlocksResult> {
  const ordered = orderBlocks(blocks);
  await repo.kvSet(BLOCKS_KEY, ordered);

  const existing = repo.contextEntries('grund').filter((e) => e.origin === 'crisis_plan' || e.blockId);
  const used = new Set<string>();
  const counters = new Map<ContextKind, number>();
  let rows = 0;
  for (const block of ordered) {
    if (block.type === 'normal') continue;
    for (const row of rowsFromBlock(block)) {
      const kind: ContextKind | null = row.akut ? 'akut' : contextKindOf(row.fields);
      if (!kind) continue;
      const order = counters.get(kind) ?? 0;
      counters.set(kind, order + 1);
      // The same line in the same block first; otherwise the same line of the same kind, e.g.
      // after a new version of the plan has been read in and its blocks have new ids.
      const same =
        existing.find((e) => !used.has(e.id) && e.text === row.text && e.blockId === block.id) ??
        existing.find((e) => !used.has(e.id) && e.text === row.text && e.kind === kind);
      if (same) {
        used.add(same.id);
        await repo.updateContextEntry(same.id, { kind, plan: kind === 'akut' ? null : row.fields, blockId: block.id, order }, false);
        rows++;
        continue;
      }
      const added = await repo.addContextEntry({ kind, text: row.text, origin: 'crisis_plan', plan: kind === 'akut' ? null : row.fields, blockId: block.id }, false);
      await repo.updateContextEntry(added.id, { order }, false);
      rows++;
    }
  }
  for (const e of existing) if (!used.has(e.id) && !(e.kind === 'akut' && !e.blockId)) await repo.removeContextEntry(e.id, false);

  // Normalläge is the person's own description, kept as the profile's normal state.
  // Only when the plan has the block: an imported plan without it keeps the normal state.
  const normalBlocks = ordered.filter((b) => b.type === 'normal');
  if (normalBlocks.length) {
    const normal = normalBlocks.flatMap((b) => blockLines(b.text).map((l) => l.text)).join(' ');
    if (normal !== repo.planSettings().normalState) await repo.updatePlanSettings({ normalState: normal });
  }
  if (repo.settings().contextMode !== 'own' && rows) await repo.updateSettings({ contextMode: 'own' });

  const routines = repo.contextOf('routine').map((e) => ({ text: e.text, fields: e.plan ?? { kind: 'routine' as const, polarity: 'both' as const } }));
  const sleepWindow = repo.planSettings().sleepWindow ? null : sleepWindowIn(routines);
  void now;
  return { rows, sleepWindow };
}

/** One block changed, e.g. from the editor. */
export async function saveBlock(repo: Repository, block: PlanBlock, now = new Date()): Promise<SaveBlocksResult> {
  const all = planBlocks(repo);
  const next = all.some((b) => b.id === block.id) ? all.map((b) => (b.id === block.id ? { ...block, updatedAt: now.toISOString() } : b)) : [...all, block];
  return savePlanBlocks(repo, next, now);
}

export async function removeBlock(repo: Repository, id: string): Promise<void> {
  await savePlanBlocks(repo, planBlocks(repo).filter((b) => b.id !== id));
}

/** One part of the plan emptied: its rows go, the heading stays. */
export async function clearBlock(repo: Repository, id: string): Promise<void> {
  const block = planBlocks(repo).find((b) => b.id === id);
  if (block) await saveBlock(repo, { ...block, text: '' });
}

// ---- the whole plan ----

export const BACKUP_KEY = 'planBackup';

/** The plan as it was before it was cleared, so the person can take it back. */
export interface PlanBackup {
  blocks: PlanBlock[];
  original: PlanOriginal | null;
  polarityWords: { up?: string; down?: string } | null;
  sleepWindow: { start: string; end: string } | null;
  at: string;
}

export function planBackup(repo: Repository): PlanBackup | null {
  return (repo.kvGet(BACKUP_KEY) as PlanBackup | null | undefined) ?? null;
}

/**
 * Clears the whole crisis plan: every block and every row made from it, standard content, the
 * plan as read in, and what the app took from the plan (its words for the directions, the sleep
 * window). Kept: the days and assessments, routine ticks, and emergency phrases the person added
 * themselves. A copy is kept so the plan can be taken back.
 */
export async function clearPlan(repo: Repository, now = new Date()): Promise<{ rows: number }> {
  const ps = repo.planSettings();
  const backup: PlanBackup = {
    blocks: planBlocks(repo),
    original: planOriginal(repo),
    polarityWords: ps.polarityWords ?? null,
    sleepWindow: ps.sleepWindow ?? null,
    at: now.toISOString(),
  };
  await repo.kvSet(BACKUP_KEY, backup);
  const before = repo.contextEntries('grund').filter((e) => e.origin === 'crisis_plan' || e.origin === 'standard' || e.blockId).length;
  await savePlanBlocks(repo, emptyPlan(now), now);
  for (const e of repo.contextEntries('grund').filter((x) => x.origin === 'standard')) await repo.removeContextEntry(e.id, false);
  await repo.kvSet(ORIGINAL_KEY, null);
  await repo.updatePlanSettings({ polarityWords: null, sleepWindow: null });
  if (repo.settings().contextMode !== 'unset') await repo.updateSettings({ contextMode: 'unset' });
  const after = repo.contextEntries('grund').filter((e) => e.origin === 'crisis_plan' || e.origin === 'standard' || e.blockId).length;
  return { rows: before - after };
}

/** Takes back the cleared plan. Routine reminders have to be set again. */
export async function restorePlan(repo: Repository): Promise<boolean> {
  const b = planBackup(repo);
  if (!b) return false;
  await savePlanBlocks(repo, b.blocks);
  await repo.kvSet(ORIGINAL_KEY, b.original);
  await repo.updatePlanSettings({ polarityWords: b.polarityWords, sleepWindow: b.sleepWindow });
  await repo.kvSet(BACKUP_KEY, null);
  return true;
}

export async function dropPlanBackup(repo: Repository): Promise<void> {
  await repo.kvSet(BACKUP_KEY, null);
}
