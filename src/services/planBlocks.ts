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
  return orderBlocks([...blocks, ...missing]);
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
      const same = existing.find((e) => !used.has(e.id) && e.text === row.text && (e.blockId === block.id || (!e.blockId && e.kind === kind)));
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
  const normal = ordered.filter((b) => b.type === 'normal').flatMap((b) => blockLines(b.text).map((l) => l.text)).join(' ');
  if (normal) await repo.updatePlanSettings({ normalState: normal });
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
