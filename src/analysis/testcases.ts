// Turns prompts/testfall.md into entries, plan and history that the scoring code can run.
// Used by the unit tests now, and by "Testa modellen" in step 2.

import type { Entry, Level, PlanItem, PlanSettings } from '../domain/types';
import { extractJsonBlock, loadPrompt } from '../prompts/loader';
import { addDays } from './dates';
import type { HistoryDay } from './scoring';

interface RawDay {
  daysAgo: number;
  time: string;
  mood: number | null;
  energy: number | null;
  wordsPerMinute: number | null;
  sleepHours: number | null;
  level: Level;
}

interface RawCase {
  id: string;
  name: string;
  expected: Level;
  history: string;
  entry: {
    time: string;
    note: string;
    mood: number | null;
    energy: number | null;
    wordsPerMinute: number | null;
    sleepHours: number | null;
  };
}

interface RawFile {
  plan: { normalState: string; sleepThresholdHours: number; signs: { id: string; kind: 'early' | 'serious'; text: string }[] };
  histories: Record<string, RawDay[]>;
  cases: RawCase[];
}

export interface TestCase {
  id: string;
  name: string;
  expected: Level;
  entry: Entry;
  history: HistoryDay[];
}

export interface TestSuite {
  version: string;
  plan: PlanItem[];
  planSettings: PlanSettings;
  cases: TestCase[];
}

/** ISO timestamp for an entry on evening `date` at `time`; times before 05:00 fall on the next calendar day. */
function timestamp(date: string, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  const dt = new Date(y, mo - 1, d, h, m, 0, 0);
  if (h < 5) dt.setDate(dt.getDate() + 1);
  return dt.toISOString();
}

export function loadTestSuite(referenceDate = '2026-10-20'): TestSuite {
  const prompt = loadPrompt('testfall');
  const raw = extractJsonBlock<RawFile>(prompt.body);
  const plan: PlanItem[] = raw.plan.signs.map((s, i) => ({
    id: s.id, kind: s.kind, text: s.text, order: i, approvedAt: '2026-01-01T00:00:00.000Z',
  }));
  const planSettings: PlanSettings = {
    normalState: raw.plan.normalState,
    sleepThresholdHours: raw.plan.sleepThresholdHours,
  };
  const cases = raw.cases.map((c): TestCase => {
    const history = (raw.histories[c.history] ?? []).map((d, i): HistoryDay => {
      const date = addDays(referenceDate, -d.daysAgo);
      return {
        level: d.level,
        entry: {
          id: `${c.id}_h${i}`, date, createdAt: timestamp(date, d.time), kind: 'checkin',
          transcript: 'Vanlig dag.', mood: d.mood, energy: d.energy,
          wordsPerMinute: d.wordsPerMinute, sleepHours: d.sleepHours,
          sleepSource: d.sleepHours == null ? null : 'garmin', stressAvg: null,
        },
      };
    });
    const e = c.entry;
    return {
      id: c.id,
      name: c.name,
      expected: c.expected,
      history,
      entry: {
        id: `${c.id}_entry`, date: referenceDate, createdAt: timestamp(referenceDate, e.time),
        kind: 'checkin', transcript: e.note, mood: e.mood, energy: e.energy,
        wordsPerMinute: e.wordsPerMinute, sleepHours: e.sleepHours,
        sleepSource: e.sleepHours == null ? null : 'garmin', stressAvg: null,
      },
    };
  });
  return { version: prompt.meta.version, plan, planSettings, cases };
}
