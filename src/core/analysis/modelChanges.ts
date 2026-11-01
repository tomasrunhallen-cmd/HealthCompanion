// Days on which the model or the analys prompt changed, for a marker in the trend view.
// Each assessment already stores its model name and prompt version.

import type { Assessment, DateKey } from '../domain/types';

export interface ModelChange {
  date: DateKey;
  from: string;
  to: string;
}

function label(a: Assessment): string | null {
  if (a.method !== 'llm' || !a.model) return null;
  return `${a.model}, prompt ${a.promptVersion ?? '?'}`;
}

export function modelChanges(assessments: Assessment[]): ModelChange[] {
  const out: ModelChange[] = [];
  let prev: string | null = null;
  for (const a of [...assessments].sort((x, y) => x.date.localeCompare(y.date) || x.createdAt.localeCompare(y.createdAt))) {
    const now = label(a);
    if (!now) continue;
    if (prev && now !== prev) out.push({ date: a.date, from: prev, to: now });
    prev = now;
  }
  return out;
}
