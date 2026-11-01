// Turns days from another diary into Dagsljus entries and assessments. The level of each
// imported day is computed by the same rules in code as an evening check-in, oldest day
// first, so earlier days count as history for later ones. No language model is involved,
// and the emergency rule runs on every note.
//
// The diary's yes/no columns give points only through the user's own mapping to the signs
// in their crisis plan; nothing is linked without the user choosing it.

import { assessEntry, type SignMatcher } from '../analysis/assess';
import { addDays } from '../analysis/dates';
import { buildHistory, type HistoryDay } from '../analysis/scoring';
import { contentTokens, matchSigns, tokenize, wordsMatch } from '../analysis/wordmatch';
import { akutLevel } from '../context/akut';
import type {
  Assessment, ContextEntry, DateKey, Entry, GarminDay, PlanItem, PlanSettings, SignMatch,
} from '../domain/types';
import {
  alcoholOf, COL_HIGH, COL_LOW, COL_MEDICATION, medicationOf, moodOf, signalsOf, sleepFromNote, SOURCE_NAME, type DiaryDay,
} from './bipolarDagbok';

/** Diary item ("Ångest", "Lågt Humör: Nedstämdhet") to the id of a plan sign, or null to ignore it. */
export type Mapping = Record<string, string | null>;

export interface SignalCount {
  signal: string;
  days: number;
}

/** Every item that occurs in the days, most frequent first. */
export function signalCounts(days: DiaryDay[]): SignalCount[] {
  const counts = new Map<string, number>();
  for (const d of days) for (const s of signalsOf(d)) counts.set(s, (counts.get(s) ?? 0) + 1);
  return Array.from(counts, ([signal, n]) => ({ signal, days: n })).sort((a, b) => b.days - a.days || a.signal.localeCompare(b.signal));
}

/**
 * A first suggestion for the mapping: an item is linked to a sign when they share a word
 * ("Handlat Mer Än Vanligt" and "Handlar saker jag inte behöver"). The user checks every
 * line before anything is imported; everything else starts as ignored.
 */
export function suggestMapping(signals: string[], plan: PlanItem[]): Mapping {
  const signs = plan.filter((p) => p.kind === 'early' || p.kind === 'serious');
  const out: Mapping = {};
  for (const signal of signals) {
    const label = signal.includes(': ') ? signal.split(': ')[1] : signal;
    const words = tokenize(label).filter((w) => w.length >= 4);
    const hit = signs.find((s) => contentTokens(s.text).some((t) => t.length >= 4 && words.some((w) => wordsMatch(w, t))));
    out[signal] = hit?.id ?? null;
  }
  return out;
}

export interface BuildInput {
  importId: string;
  days: DiaryDay[];
  mapping: Mapping;
  plan: PlanItem[];
  planSettings: PlanSettings;
  /** What is already in Dagsljus. A date written in Dagsljus is never replaced by an imported day. */
  entries: Entry[];
  assessments: Assessment[];
  context: ContextEntry[];
  /** Measured days for the period: the Garmin archive and the recent window. */
  garmin: Record<DateKey, GarminDay>;
  now: Date;
  /** Called every 50 days; the import also yields to the screen then, so it stays responsive. */
  onProgress?: (done: number, total: number) => void;
}

export interface BuildResult {
  entries: Entry[];
  assessments: Assessment[];
  /** Medication answered "NEJ": the only answers the scoring uses. */
  context: ContextEntry[];
  /** Dates already in Dagsljus, left as they were. */
  skipped: DateKey[];
  levels: { green: number; yellow: number; red: number };
  /** Days where the emergency rule matched in full. */
  akut: number;
  /** Days whose sleep came from Garmin, and from the note's "Sömn:" line. */
  sleepFromGarmin: number;
  sleepFromNote: number;
}

function eveningIso(date: DateKey): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 21, 0, 0, 0).toISOString();
}

/** The original values worth keeping: mood, medication and every "JA". */
function keptValues(day: DiaryDay): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(day.values)) {
    if (k === COL_HIGH || k === COL_LOW || k === COL_MEDICATION ? v && v !== '-' : v === 'JA') out[k] = v;
  }
  return out;
}

export async function buildImport(input: BuildInput): Promise<BuildResult> {
  const taken = new Set(input.entries.map((e) => e.date));
  const days = input.days.filter((d) => !taken.has(d.date));
  const skipped = input.days.filter((d) => taken.has(d.date)).map((d) => d.date);
  const signs = new Set(input.plan.filter((p) => p.kind === 'early' || p.kind === 'serious').map((p) => p.id));
  const userAkut = input.context.filter((e) => e.kind === 'akut').map((e) => e.text);
  const alcohol = new Set(days.filter(alcoholOf).map((d) => d.date));
  const stamp = input.now.toISOString();

  const medication: ContextEntry[] = days
    .filter((d) => medicationOf(d) === false)
    .map((d, i) => ({
      id: `${input.importId}_med_${d.date}`, layer: 'dagligt', kind: 'medication_taken', text: '', order: i,
      origin: 'user', createdAt: stamp, approvedAt: stamp, date: d.date, taken: false, importId: input.importId,
    }));
  const bank = [...input.context, ...medication];

  const history: HistoryDay[] = buildHistory(input.entries, input.assessments);
  const out: BuildResult = {
    entries: [], assessments: [], context: medication, skipped,
    levels: { green: 0, yellow: 0, red: 0 }, akut: 0, sleepFromGarmin: 0, sleepFromNote: 0,
  };

  for (const day of days) {
    const g = input.garmin[day.date];
    const noteSleep = sleepFromNote(day.note);
    const sleep = g?.sleepHours ?? noteSleep;
    if (g?.sleepHours != null) out.sleepFromGarmin++;
    else if (noteSleep != null) out.sleepFromNote++;
    const entry: Entry = {
      id: `${input.importId}_${day.date}`,
      date: day.date,
      createdAt: eveningIso(day.date),
      kind: 'imported',
      transcript: day.note,
      mood: moodOf(day),
      energy: null,
      wordsPerMinute: null,
      sleepHours: sleep,
      sleepSource: g?.sleepHours != null ? 'garmin' : noteSleep != null ? 'transcript' : null,
      stressAvg: g?.stressAvg ?? null,
      ...(alcohol.has(addDays(day.date, -1)) ? { strainYesterday: true } : {}),
      imported: { importId: input.importId, source: 'bipolar-dagbok', values: keptValues(day) },
    };

    const mapped: SignMatch[] = [];
    for (const s of signalsOf(day)) {
      const id = input.mapping[s];
      if (id && signs.has(id) && !mapped.some((m) => m.planItemId === id)) mapped.push({ planItemId: id, quote: `${SOURCE_NAME}: ${s}` });
    }
    const matcher: SignMatcher = {
      async match(note, planSigns) {
        // The user's mapping first, then word matching in the note, as on the phone without a model.
        const words = note.trim() ? matchSigns(note, planSigns).filter((m) => !mapped.some((x) => x.planItemId === m.planItemId)) : [];
        return { matches: [...mapped, ...words], sentence: null, method: 'import', model: null, promptId: null, promptVersion: null };
      },
    };

    const level = day.note ? akutLevel(day.note, userAkut) : null;
    const a = await assessEntry({
      entry, plan: input.plan, planSettings: input.planSettings, history, matcher, garmin: input.garmin,
      context: bank, akut: level === 'full', akutMild: level === 'mild', now: input.now,
    });
    const assessment: Assessment = { ...a, id: `${input.importId}_a_${day.date}`, method: 'import', createdAt: entry.createdAt };
    if (assessment.akut) out.akut++;
    out.levels[assessment.level]++;
    out.entries.push(entry);
    out.assessments.push(assessment);
    history.push({ entry, level: assessment.level });
    if (out.entries.length % 50 === 0) {
      input.onProgress?.(out.entries.length, days.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  input.onProgress?.(out.entries.length, days.length);
  return out;
}
