// Import from another diary: parse, map, compute and save. The screen calls these steps.

import type { DateKey } from '../core/domain/types';
import { parseDiaryFiles, type DiaryImport } from '../import/bipolarDagbok';
import { buildImport, type BuildResult, type Mapping } from '../import/transform';
import type { ImportRecord, Repository } from '../storage/repository';

export { parseDiaryFiles };

/** The period the import covers: first to last filled-in day. */
export function periodOf(parsed: DiaryImport): { from: DateKey; to: DateKey } | null {
  if (!parsed.days.length) return null;
  return { from: parsed.days[0].date, to: parsed.days[parsed.days.length - 1].date };
}

/** Dates in the files that already have a day written in Dagsljus; those are left as they are. */
export function overlapWith(repo: Repository, parsed: DiaryImport): number {
  const taken = new Set(repo.entries().map((e) => e.date));
  return parsed.days.filter((d) => taken.has(d.date)).length;
}

export async function runDiaryImport(
  repo: Repository,
  parsed: DiaryImport,
  mapping: Mapping,
  opts: { now?: Date; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ record: ImportRecord; result: BuildResult }> {
  const now = opts.now ?? new Date();
  const period = periodOf(parsed);
  if (!period) throw new Error('Filerna har inga ifyllda dagar.');
  const importId = `imp${now.getTime().toString(36)}`;
  const result = await buildImport({
    importId,
    days: parsed.days,
    mapping,
    plan: repo.plan(),
    planSettings: repo.planSettings(),
    entries: repo.entries(),
    assessments: repo.assessments(),
    context: repo.contextEntries(),
    garmin: repo.allGarminDays(),
    now,
    onProgress: opts.onProgress,
  });
  const record: ImportRecord = {
    id: importId,
    source: 'bipolar-dagbok',
    at: now.toISOString(),
    from: period.from,
    to: period.to,
    days: result.entries.length,
    mapping,
    skipped: result.skipped.length,
  };
  await repo.saveImport(record, result.entries, result.assessments, result.context);
  return { record, result };
}
