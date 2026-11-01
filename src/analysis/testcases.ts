// Turns prompts/testfall.md into entries, plan, context and history that the scoring code
// can run. Used by the unit tests, by "Testa modellen" and by `npm run prompt:check`.

import { entriesFromPlan } from '../context/buildContext';
import { loadStandard } from '../context/standard';
import type { AkutLevel } from '../context/akut';
import type { ContextEntry, ContextKind, DateKey, Entry, GarminDay, Level, PlanItem, PlanItemKind, PlanSettings } from '../domain/types';
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
  stressAvg?: number | null;
  level: Level;
}

interface RawCase {
  id: string;
  name: string;
  expected: Level;
  history: string;
  /** "standard": the standard content, unconfirmed, instead of the test plan's signs. */
  plan?: 'standard';
  /** A serious sign matched, so the plan's red actions must show whatever the level. */
  redActions?: boolean;
  /** Neutral trend lines the green day must show. */
  trend?: string[];
  entry: {
    time: string;
    note: string;
    mood: number | null;
    energy: number | null;
    wordsPerMinute: number | null;
    sleepHours: number | null;
    stressAvg?: number | null;
    /** Sleep onset "HH:MM" by the watch, for the late-sleep rule. */
    sleepStart?: string;
    strainYesterday?: boolean;
    /** Medication answer per evening, keyed by days ago (0 is today). */
    medication?: Record<string, boolean>;
  };
  reference: { matches: { sign: string; quote: string }[] } | { akut: AkutLevel };
}

interface RawFile {
  plan: {
    normalState: string;
    sleepThresholdHours: number;
    signs: { id: string; kind: 'early' | 'serious'; text: string }[];
    actions?: { kind: 'action_yellow' | 'action_red'; text: string }[];
    context?: { kind: ContextKind; text: string }[];
  };
  histories: Record<string, RawDay[]>;
  cases: RawCase[];
}

/** What a careful model answers for a case: the plan signs the note describes, with a quote. */
export interface ReferenceMatch {
  planItemId: string;
  sign: string;
  quote: string;
}

export interface TestCase {
  id: string;
  name: string;
  expected: Level;
  entry: Entry;
  history: HistoryDay[];
  /** The plan this case is judged against: the test plan, or the standard content. */
  plan: PlanItem[];
  planSettings: PlanSettings;
  /** The watch's day for the case's evening, when the case has a sleep onset. */
  garmin: Record<DateKey, GarminDay>;
  /** The case's context bank: its plan, the test plan's other grund rows and medication answers. */
  context: ContextEntry[];
  /** Null for emergency cases, which never reach a model. */
  reference: ReferenceMatch[] | null;
  /** The emergency rule's expected verdict on the note, or null when it should not match. */
  expectedAkut: AkutLevel | null;
  /** The assessment must show the plan's actions at red (a serious sign matched). */
  expectedRedActions: boolean;
  /** Neutral trend lines on a green day; empty for most cases. */
  expectedTrend: string[];
}

export interface TestSuite {
  version: string;
  /** The test plan's signs and actions, shared by every case that does not use the standard content. */
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

const APPROVED = '2026-01-01T00:00:00.000Z';

function standardPlan(): PlanItem[] {
  return loadStandard()
    .rows.filter((r) => ['early', 'serious', 'action_yellow', 'action_red'].includes(r.kind))
    .map((r, i) => ({ id: `std${i + 1}`, kind: r.kind as PlanItemKind, text: r.text, order: i, approvedAt: null, origin: 'standard' as const }));
}

export function loadTestSuite(referenceDate = '2026-10-20'): TestSuite {
  const prompt = loadPrompt('testfall');
  const raw = extractJsonBlock<RawFile>(prompt.body);
  const plan: PlanItem[] = [
    ...raw.plan.signs.map((s, i) => ({ id: s.id, kind: s.kind, text: s.text, order: i, approvedAt: APPROVED })),
    ...(raw.plan.actions ?? []).map((a, i) => ({ id: `a${i + 1}`, kind: a.kind, text: a.text, order: i, approvedAt: APPROVED })),
  ];
  const planSettings: PlanSettings = {
    normalState: raw.plan.normalState,
    sleepThresholdHours: raw.plan.sleepThresholdHours,
  };
  const extra: ContextEntry[] = (raw.plan.context ?? []).map((c, i) => ({
    id: `tc${i + 1}`, layer: 'grund', kind: c.kind, text: c.text, order: i, origin: 'crisis_plan', createdAt: APPROVED, approvedAt: APPROVED,
  }));
  const ids = new Set<string>();
  const cases = raw.cases.map((c): TestCase => {
    if (ids.has(c.id)) throw new Error(`Testfallet ${c.id} finns två gånger.`);
    ids.add(c.id);
    const days = raw.histories[c.history];
    if (!days) throw new Error(`Testfallet ${c.id} pekar på historiken ${c.history}, som saknas.`);
    const history = days.map((d, i): HistoryDay => {
      const date = addDays(referenceDate, -d.daysAgo);
      return {
        level: d.level,
        entry: {
          id: `${c.id}_h${i}`, date, createdAt: timestamp(date, d.time), kind: 'checkin',
          transcript: 'Vanlig dag.', mood: d.mood, energy: d.energy,
          wordsPerMinute: d.wordsPerMinute, sleepHours: d.sleepHours,
          sleepSource: d.sleepHours == null ? null : 'garmin', stressAvg: d.stressAvg ?? null,
        },
      };
    });
    const e = c.entry;
    const casePlan = c.plan === 'standard' ? standardPlan() : plan;
    const medication: ContextEntry[] = Object.entries(e.medication ?? {}).map(([ago, taken]) => ({
      id: `${c.id}_med${ago}`, layer: 'dagligt', kind: 'medication_taken', text: '', order: 0, origin: 'user',
      createdAt: APPROVED, approvedAt: APPROVED, date: addDays(referenceDate, -Number(ago)), taken,
    }));
    let reference: ReferenceMatch[] | null = null;
    let expectedAkut: AkutLevel | null = null;
    if ('akut' in c.reference) {
      expectedAkut = c.reference.akut;
    } else {
      reference = c.reference.matches.map((m) => {
        const item = casePlan.find((p) => p.text === m.sign);
        if (!item) throw new Error(`Referenssvaret i ${c.id} nämner tecknet ”${m.sign}”, som inte finns i planen.`);
        if (!e.note.includes(m.quote)) throw new Error(`Citatet ”${m.quote}” i ${c.id} står inte i anteckningen.`);
        return { planItemId: item.id, sign: m.sign, quote: m.quote };
      });
    }
    const garmin: Record<DateKey, GarminDay> = e.sleepStart
      ? {
          [referenceDate]: {
            date: referenceDate, sleepHours: e.sleepHours, deepMinutes: null, remMinutes: null, sleepStart: e.sleepStart,
            sleepEnd: null, stressAvg: e.stressAvg ?? null, stressHighMinutes: null, bodyBatteryWake: null, fetchedAt: APPROVED,
          },
        }
      : {};
    return {
      id: c.id,
      name: c.name,
      expected: c.expected,
      history,
      garmin,
      plan: casePlan,
      planSettings,
      context: [...entriesFromPlan(casePlan, planSettings.normalState), ...extra, ...medication],
      reference,
      expectedAkut,
      expectedRedActions: !!c.redActions,
      expectedTrend: c.trend ?? [],
      entry: {
        id: `${c.id}_entry`, date: referenceDate, createdAt: timestamp(referenceDate, e.time),
        kind: 'checkin', transcript: e.note, mood: e.mood, energy: e.energy,
        wordsPerMinute: e.wordsPerMinute, sleepHours: e.sleepHours,
        sleepSource: e.sleepHours == null ? null : 'garmin', stressAvg: e.stressAvg ?? null,
        ...(e.strainYesterday ? { strainYesterday: true } : {}),
      },
    };
  });
  return { version: prompt.meta.version, plan, planSettings, cases };
}
