// The app's single source of data. Keeps a cache in memory and writes through to the backend.

import { buildHistory, type HistoryDay } from '../core/analysis/scoring';
import { mergeSources } from '../core/analysis/sources';
import {
  DEFAULT_APP_SETTINGS, DEFAULT_PLAN_SETTINGS, LAYER_OF, PLAN_KINDS,
  type AppSettings, type Assessment, type ContextEntry, type ContextKind, type ContextLayer, type ContextOrigin,
  type Correction, type DateKey, type MeasuredDay, type PlanFields, type RoutineSettings, type Suggestion, type Entry, type GarminDay, type ImportSource, type PlanItem, type PlanItemKind, type PlanSettings,
} from '../core/domain/types';
import { addDays } from '../core/analysis/dates';
import { fieldsFromKind } from '../core/plan/fields';
import { moodFromTen } from '../core/analysis/mood';
import { moodOf, type DiaryDay } from '../import/bipolarDagbok';
import type { SentRequest, Usage } from '../core/llm/types';
import { addUsage, DEFAULT_LLM_CONFIG, pruneUsage, type LlmConfig, type UsageLog } from '../llm/config';
import type { Collection, DocBackend, Snapshot, StorageInfo } from './backend';

export const EXPORT_FORMAT = 'dagsljus-export';
export const EXPORT_VERSION = 1;

export interface ExportData {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  data: Snapshot;
}

type Listener = () => void;

export interface GarminStatus {
  /** True once the user has connected a key. The key itself is in Keychain/Keystore. */
  connected: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

export const DEFAULT_GARMIN_STATUS: GarminStatus = { connected: false, lastSyncAt: null, lastError: null };

const GARMIN_KEEP_DAYS = 120;
export const GARMIN_MONTH_PREFIX = 'garminMonth:';

/** One import from another diary, kept so it can be shown and removed. */
export interface ImportRecord {
  id: string;
  source: ImportSource;
  at: string;
  from: DateKey;
  to: DateKey;
  days: number;
  /** Diary item to plan sign id, or null for ignored. */
  mapping: Record<string, string | null>;
  /** Dates already written in Dagsljus, left as they were. */
  skipped: number;
}

/** Version 2: crisis plan and normal state moved into the context bank. Version 3: plan rows get their fields. */
export const SCHEMA_VERSION = 4;

const LAYERS: ContextLayer[] = ['grund', 'profil', 'dagligt'];

export interface NewContextEntry {
  kind: ContextKind;
  text: string;
  origin: ContextOrigin;
  id?: string;
  /** Defaults to now; pass null for standard content the user has not confirmed. */
  approvedAt?: string | null;
  createdAt?: string;
  date?: DateKey | null;
  taken?: boolean | null;
  correction?: Correction | null;
  /** grund: the plan row's fields. Defaults to fields derived from the kind. */
  plan?: PlanFields | null;
  routine?: RoutineSettings | null;
  routineId?: string | null;
  done?: boolean | null;
  blockId?: string | null;
}

let idCounter = 0;
function contextId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `c_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function byKindThenOrder(a: ContextEntry, b: ContextEntry): number {
  return a.kind.localeCompare(b.kind) || a.order - b.order || a.createdAt.localeCompare(b.createdAt);
}

export class Repository {
  private snap!: Snapshot;
  private listeners = new Set<Listener>();
  /** Bumps on every change so React can re-render. */
  revision = 0;

  private constructor(private backend: DocBackend) {}

  static async create(backend: DocBackend): Promise<Repository> {
    const r = new Repository(backend);
    r.snap = await backend.load();
    await r.migrate();
    return r;
  }

  /**
   * Moves data saved before the context bank: plan rows become grund entries
   * (origin crisis_plan), the normal state becomes a profil entry. Safe to run again.
   */
  private async migrate(): Promise<void> {
    const version = Number(this.snap.kv.schemaVersion ?? 1);
    if (version >= SCHEMA_VERSION && Object.keys(this.snap.plan).length === 0) return;
    for (const [id, raw] of Object.entries(this.snap.plan)) {
      const old = raw as PlanItem;
      if (!this.snap.grund[id]) {
        const entry: ContextEntry = {
          id, layer: 'grund', kind: old.kind, text: old.text, order: old.order, origin: 'crisis_plan',
          createdAt: old.approvedAt ?? new Date().toISOString(), approvedAt: old.approvedAt ?? null,
        };
        this.snap.grund[id] = entry;
        await this.backend.put('grund', id, entry);
      }
      delete this.snap.plan[id];
      await this.backend.remove('plan', id);
    }
    const ps = this.snap.kv.planSettings as (Partial<PlanSettings> & { normalState?: string }) | undefined;
    if (ps && typeof ps.normalState === 'string') {
      const text = ps.normalState.trim();
      if (text && !this.contextEntries('profil').some((e) => e.kind === 'normal_state')) {
        const now = new Date().toISOString();
        const entry: ContextEntry = { id: contextId(), layer: 'profil', kind: 'normal_state', text, order: 0, origin: 'user', createdAt: now, approvedAt: now };
        this.snap.profil[entry.id] = entry;
        await this.backend.put('profil', entry.id, entry);
      }
      const { normalState: _drop, ...rest } = ps;
      this.snap.kv.planSettings = rest;
      await this.backend.put('kv', 'planSettings', rest);
    }
    // Version 3: every plan row gets its fields from its kind. Polarity is "both" until the person changes it.
    for (const e of Object.values(this.snap.grund) as ContextEntry[]) {
      if (e.plan) continue;
      const fields = fieldsFromKind(e.kind);
      if (!fields) continue;
      const next: ContextEntry = { ...e, plan: fields };
      this.snap.grund[e.id] = next;
      await this.backend.put('grund', e.id, next);
    }
    const settings = this.settings();
    if (settings.contextMode === 'unset' && this.contextEntries('grund').some((e) => e.origin !== 'standard')) {
      this.snap.kv.settings = { ...settings, contextMode: 'own' };
      await this.backend.put('kv', 'settings', this.snap.kv.settings);
    }
    // Version 4: stämning moves from 1–10 to −3…+3. The old value is kept on the entry.
    // Imported days are read again from the diary's own words.
    if (version < 4) {
      for (const e of Object.values(this.snap.entries) as Entry[]) {
        if (e.mood == null || e.moodTen != null) continue;
        const fromDiary = e.imported ? moodOf({ date: e.date, values: e.imported.values } as DiaryDay) : null;
        const next: Entry = { ...e, mood: fromDiary ?? moodFromTen(e.mood), moodTen: e.mood };
        this.snap.entries[e.id] = next;
        await this.backend.put('entries', e.id, next);
      }
    }
    this.snap.kv.schemaVersion = SCHEMA_VERSION;
    await this.backend.put('kv', 'schemaVersion', SCHEMA_VERSION);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.revision++;
    this.listeners.forEach((l) => l());
  }

  storageInfo(): StorageInfo {
    return this.backend.info();
  }

  // ---- settings ----
  settings(): AppSettings {
    return { ...DEFAULT_APP_SETTINGS, ...(this.snap.kv.settings as Partial<AppSettings> | undefined) };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...this.settings(), ...patch };
    this.snap.kv.settings = next;
    await this.backend.put('kv', 'settings', next);
    this.changed();
    return next;
  }

  /** Sleep limit from settings; the normal state is read from the profil layer. */
  planSettings(): PlanSettings {
    const stored = (this.snap.kv.planSettings as Partial<PlanSettings> | undefined) ?? {};
    const normalState = this.contextEntries('profil')
      .filter((e) => e.kind === 'normal_state')
      .map((e) => e.text.trim())
      .filter(Boolean)
      .join('. ');
    return {
      ...DEFAULT_PLAN_SETTINGS,
      sleepThresholdHours: stored.sleepThresholdHours ?? DEFAULT_PLAN_SETTINGS.sleepThresholdHours,
      normalState,
      ...(stored.polarityWords ? { polarityWords: stored.polarityWords } : {}),
      ...(stored.sleepWindow ? { sleepWindow: stored.sleepWindow } : {}),
    };
  }

  /** The normal state is the user's own words: saving it replaces the profil entry. */
  async updatePlanSettings(patch: Partial<PlanSettings>): Promise<void> {
    const kept: Partial<PlanSettings> = {};
    if (patch.sleepThresholdHours != null) kept.sleepThresholdHours = patch.sleepThresholdHours;
    if (patch.polarityWords !== undefined) kept.polarityWords = patch.polarityWords;
    if (patch.sleepWindow !== undefined) kept.sleepWindow = patch.sleepWindow;
    if (Object.keys(kept).length) {
      const stored = (this.snap.kv.planSettings as Partial<PlanSettings> | undefined) ?? {};
      const next = { ...stored, ...kept };
      this.snap.kv.planSettings = next;
      await this.backend.put('kv', 'planSettings', next);
    }
    if (patch.normalState != null) {
      const existing = this.contextEntries('profil').filter((e) => e.kind === 'normal_state');
      const text = patch.normalState.trim();
      for (const e of existing.slice(text ? 1 : 0)) await this.removeContextEntry(e.id, false);
      if (text && existing[0]) await this.updateContextEntry(existing[0].id, { text, origin: 'user' }, false);
      else if (text) await this.addContextEntry({ kind: 'normal_state', text, origin: 'user' }, false);
    }
    this.changed();
  }

  // ---- language model ----
  llmConfig(): LlmConfig {
    return { ...DEFAULT_LLM_CONFIG, ...(this.snap.kv.llm as Partial<LlmConfig> | undefined) };
  }

  async updateLlmConfig(patch: Partial<LlmConfig>): Promise<LlmConfig> {
    const next = { ...this.llmConfig(), ...patch };
    this.snap.kv.llm = next;
    await this.backend.put('kv', 'llm', next);
    this.changed();
    return next;
  }

  usageLog(): UsageLog {
    return (this.snap.kv.usage as UsageLog | undefined) ?? {};
  }

  async recordUsage(date: DateKey, usage: Usage): Promise<void> {
    if (!usage.inputTokens && !usage.outputTokens) return;
    const next = pruneUsage(addUsage(this.usageLog(), date, usage), date);
    this.snap.kv.usage = next;
    await this.backend.put('kv', 'usage', next);
    this.changed();
  }

  /** The exact text sent with the latest request, for the prompt library. */
  lastSent(): SentRequest | null {
    return (this.snap.kv.lastSent as SentRequest | undefined) ?? null;
  }

  async setLastSent(req: SentRequest): Promise<void> {
    this.snap.kv.lastSent = req;
    await this.backend.put('kv', 'lastSent', req);
  }

  // ---- Garmin ----
  garminStatus(): GarminStatus {
    return { ...DEFAULT_GARMIN_STATUS, ...(this.snap.kv.garminStatus as Partial<GarminStatus> | undefined) };
  }

  async updateGarminStatus(patch: Partial<GarminStatus>): Promise<GarminStatus> {
    const next = { ...this.garminStatus(), ...patch };
    this.snap.kv.garminStatus = next;
    await this.backend.put('kv', 'garminStatus', next);
    this.changed();
    return next;
  }

  /** Measured days keyed by Garmin's calendar date. */
  garminDays(): Record<DateKey, GarminDay> {
    return (this.snap.kv.garmin as Record<DateKey, GarminDay> | undefined) ?? {};
  }

  garminDay(date: DateKey): GarminDay | null {
    return this.garminDays()[date] ?? null;
  }

  /** Replaces the given days (Garmin revises recent days) and keeps 120 days. */
  async saveGarminDays(days: GarminDay[], today: DateKey): Promise<void> {
    const cutoff = addDays(today, -GARMIN_KEEP_DAYS);
    const next: Record<DateKey, GarminDay> = {};
    for (const [d, v] of Object.entries(this.garminDays())) if (d > cutoff) next[d] = v;
    for (const day of days) if (day.date > cutoff) next[day.date] = day;
    this.snap.kv.garmin = next;
    await this.backend.put('kv', 'garmin', next);
    this.changed();
  }

  // ---- sleep and stress from every source (B5) ----
  /** The person's own sleep and stress, entered in the check-in. */
  manualDays(): Record<DateKey, MeasuredDay> {
    return (this.snap.kv.manualMeasures as Record<DateKey, MeasuredDay> | undefined) ?? {};
  }

  async saveManualDay(day: Omit<MeasuredDay, 'source' | 'fetchedAt'>, now = new Date()): Promise<void> {
    const next = { ...this.manualDays(), [day.date]: { ...day, source: 'manual' as const, fetchedAt: now.toISOString() } };
    this.snap.kv.manualMeasures = next;
    await this.backend.put('kv', 'manualMeasures', next);
    this.changed();
  }

  /** Days from Apple Hälsa or Health Connect. */
  healthDays(): Record<DateKey, MeasuredDay> {
    return (this.snap.kv.healthDays as Record<DateKey, MeasuredDay> | undefined) ?? {};
  }

  async saveHealthDays(days: MeasuredDay[]): Promise<void> {
    const next = { ...this.healthDays() };
    for (const d of days) next[d.date] = { ...d, source: 'health' };
    this.snap.kv.healthDays = next;
    await this.backend.put('kv', 'healthDays', next);
    this.changed();
  }

  /** The recent days of all sources merged: own entry first, then Garmin, then the phone's health app. */
  measuredDays(): Record<DateKey, MeasuredDay> {
    return mergeSources({ manual: this.manualDays(), garmin: this.garminDays(), health: this.healthDays() });
  }

  measuredDay(date: DateKey): MeasuredDay | null {
    return this.measuredDays()[date] ?? null;
  }

  /** Like measuredDays, with the Garmin archive from a diary import. */
  allMeasuredDays(): Record<DateKey, MeasuredDay> {
    return mergeSources({ manual: this.manualDays(), garmin: this.allGarminDays(), health: this.healthDays() });
  }

  // ---- Garmin history, one document per month ----
  /** Older measured days, fetched for an import from another diary. Kept apart from the 120-day window. */
  garminArchive(): Record<DateKey, GarminDay> {
    const out: Record<DateKey, GarminDay> = {};
    for (const [k, v] of Object.entries(this.snap.kv)) {
      if (k.startsWith(GARMIN_MONTH_PREFIX)) Object.assign(out, v as Record<DateKey, GarminDay>);
    }
    return out;
  }

  /** The archive and the recent window together; the recent window wins on overlap. */
  allGarminDays(): Record<DateKey, GarminDay> {
    return { ...this.garminArchive(), ...this.garminDays() };
  }

  async saveGarminArchive(days: GarminDay[]): Promise<void> {
    const months = new Map<string, GarminDay[]>();
    for (const d of days) {
      const m = d.date.slice(0, 7);
      months.set(m, [...(months.get(m) ?? []), d]);
    }
    for (const [m, list] of months) {
      const key = `${GARMIN_MONTH_PREFIX}${m}`;
      const next = { ...((this.snap.kv[key] as Record<DateKey, GarminDay> | undefined) ?? {}) };
      for (const d of list) next[d.date] = d;
      this.snap.kv[key] = next;
      await this.backend.put('kv', key, next);
    }
    if (months.size) this.changed();
  }

  // ---- imports from another diary ----
  imports(): ImportRecord[] {
    return (this.snap.kv.imports as ImportRecord[] | undefined) ?? [];
  }

  /** Saves a whole import in one go and records it, so it can be removed again. */
  async saveImport(record: ImportRecord, entries: Entry[], assessments: Assessment[], context: ContextEntry[]): Promise<void> {
    for (const e of entries) {
      this.snap.entries[e.id] = e;
      await this.backend.put('entries', e.id, e);
    }
    for (const a of assessments) {
      this.snap.assessments[a.id] = a;
      await this.backend.put('assessments', a.id, a);
    }
    for (const c of context) {
      this.snap[c.layer][c.id] = c;
      await this.backend.put(c.layer, c.id, c);
    }
    const list = [...this.imports().filter((r) => r.id !== record.id), record];
    this.snap.kv.imports = list;
    await this.backend.put('kv', 'imports', list);
    this.changed();
  }

  /** Removes every day, assessment and context entry an import created. Days written in Dagsljus stay. */
  async removeImport(importId: string): Promise<number> {
    const entries = this.entries().filter((e) => e.imported?.importId === importId);
    const ids = new Set(entries.map((e) => e.id));
    for (const e of entries) {
      delete this.snap.entries[e.id];
      await this.backend.remove('entries', e.id);
    }
    for (const a of this.assessments().filter((x) => ids.has(x.entryId))) {
      delete this.snap.assessments[a.id];
      await this.backend.remove('assessments', a.id);
    }
    for (const c of this.contextEntries().filter((x) => x.importId === importId)) {
      delete this.snap[c.layer][c.id];
      await this.backend.remove(c.layer, c.id);
    }
    const list = this.imports().filter((r) => r.id !== importId);
    this.snap.kv.imports = list;
    await this.backend.put('kv', 'imports', list);
    this.changed();
    return entries.length;
  }

  // ---- small app state ----
  kvGet(key: string): unknown {
    return this.snap.kv[key];
  }

  async kvSet(key: string, value: unknown): Promise<void> {
    this.snap.kv[key] = value;
    await this.backend.put('kv', key, value);
    this.changed();
  }

  // ---- suggestions: proposals waiting for the user, never part of the bank itself ----
  suggestions(): Suggestion[] {
    return (this.snap.kv.suggestions as Suggestion[] | undefined) ?? [];
  }

  pendingSuggestions(): Suggestion[] {
    return this.suggestions().filter((s) => s.status === 'pending');
  }

  async saveSuggestions(list: Suggestion[]): Promise<void> {
    this.snap.kv.suggestions = list;
    await this.backend.put('kv', 'suggestions', list);
    this.changed();
  }

  // ---- context bank ----
  findEntry(id: string): ContextEntry | null {
    for (const layer of LAYERS) {
      const e = this.snap[layer][id] as ContextEntry | undefined;
      if (e) return e;
    }
    return null;
  }

  contextEntries(layer?: ContextLayer): ContextEntry[] {
    const layers = layer ? [layer] : LAYERS;
    return layers.flatMap((l) => (Object.values(this.snap[l]) as ContextEntry[]).sort(byKindThenOrder));
  }

  contextOf(kind: ContextKind): ContextEntry[] {
    return this.contextEntries(LAYER_OF[kind]).filter((e) => e.kind === kind);
  }

  async addContextEntry(input: NewContextEntry, notify = true): Promise<ContextEntry> {
    const now = new Date().toISOString();
    const layer = LAYER_OF[input.kind];
    const order = this.contextOf(input.kind).reduce((m, e) => Math.max(m, e.order + 1), 0);
    const entry: ContextEntry = {
      id: input.id ?? contextId(),
      layer,
      kind: input.kind,
      text: input.text.trim(),
      order,
      origin: input.origin,
      createdAt: input.createdAt ?? now,
      approvedAt: input.approvedAt === undefined ? now : input.approvedAt,
      ...(input.date !== undefined ? { date: input.date } : {}),
      ...(input.taken !== undefined ? { taken: input.taken } : {}),
      ...(input.correction !== undefined ? { correction: input.correction } : {}),
      ...(input.routine !== undefined ? { routine: input.routine } : {}),
      ...(input.blockId !== undefined ? { blockId: input.blockId } : {}),
      ...(input.routineId !== undefined ? { routineId: input.routineId } : {}),
      ...(input.done !== undefined ? { done: input.done } : {}),
      ...(layer === 'grund' && (input.plan ?? fieldsFromKind(input.kind)) ? { plan: input.plan ?? fieldsFromKind(input.kind) } : {}),
    };
    this.snap[layer][entry.id] = entry;
    await this.backend.put(layer as Collection, entry.id, entry);
    if (notify) this.changed();
    return entry;
  }

  async updateContextEntry(id: string, patch: Partial<Omit<ContextEntry, 'id' | 'layer'>>, notify = true): Promise<void> {
    const e = this.findEntry(id);
    if (!e) return;
    const next: ContextEntry = { ...e, ...patch, layer: e.layer, id: e.id };
    if (patch.kind && LAYER_OF[patch.kind] !== e.layer) throw new Error('Posten kan inte flyttas mellan lager');
    this.snap[e.layer][id] = next;
    await this.backend.put(e.layer, id, next);
    if (notify) this.changed();
  }

  async removeContextEntry(id: string, notify = true): Promise<void> {
    const e = this.findEntry(id);
    if (!e) return;
    delete this.snap[e.layer][id];
    await this.backend.remove(e.layer, id);
    if (notify) this.changed();
  }

  /** Replaces a whole layer, used by the context import. */
  async replaceLayer(layer: ContextLayer, entries: ContextEntry[]): Promise<void> {
    for (const id of Object.keys(this.snap[layer])) {
      delete this.snap[layer][id];
      await this.backend.remove(layer, id);
    }
    for (const e of entries) {
      if (e.layer !== layer) throw new Error('Posten hör till ett annat lager');
      this.snap[layer][e.id] = e;
      await this.backend.put(layer, e.id, e);
    }
    this.changed();
  }

  /** Moves an entry one step up or down within its kind. */
  async moveContextEntry(id: string, dir: -1 | 1): Promise<void> {
    const e = this.findEntry(id);
    if (!e) return;
    const list = this.contextOf(e.kind);
    const idx = list.findIndex((x) => x.id === id);
    const other = list[idx + dir];
    if (!other) return;
    await this.updateContextEntry(e.id, { order: other.order }, false);
    await this.updateContextEntry(other.id, { order: e.order }, false);
    this.changed();
  }

  // ---- crisis plan: the plan kinds of the grund layer ----
  plan(): PlanItem[] {
    return this.contextEntries('grund')
      .filter((e) => (PLAN_KINDS as string[]).includes(e.kind))
      .map((e) => ({ id: e.id, kind: e.kind as PlanItemKind, text: e.text, order: e.order, approvedAt: e.approvedAt, origin: e.origin, ...(e.plan ? { plan: e.plan } : {}) }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.order - b.order);
  }

  planOf(kind: PlanItemKind): PlanItem[] {
    return this.plan().filter((p) => p.kind === kind).sort((a, b) => a.order - b.order);
  }

  /** Adds approved rows at the end of their category. */
  async addPlanItems(rows: { kind: PlanItemKind; text: string; id: string }[], origin: ContextOrigin = 'crisis_plan'): Promise<void> {
    for (const row of rows) {
      await this.addContextEntry({ id: row.id, kind: row.kind, text: row.text, origin, approvedAt: origin === 'standard' ? null : undefined }, false);
    }
    this.changed();
  }

  /** Editing a row is the user's own wording from then on, also for standard content. */
  async updatePlanItem(id: string, text: string): Promise<void> {
    const e = this.findEntry(id);
    if (!e) return;
    await this.updateContextEntry(id, {
      text: text.trim(),
      approvedAt: new Date().toISOString(),
      origin: e.origin === 'standard' ? 'user' : e.origin,
    });
  }

  async removePlanItem(id: string): Promise<void> {
    await this.removeContextEntry(id);
  }

  async movePlanItem(id: string, dir: -1 | 1): Promise<void> {
    await this.moveContextEntry(id, dir);
  }

  // ---- entries and assessments ----
  entries(): Entry[] {
    return (Object.values(this.snap.entries) as Entry[]).sort((a, b) =>
      a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date),
    );
  }

  entryFor(date: DateKey): Entry | null {
    return this.entries().find((e) => e.date === date) ?? null;
  }

  assessments(): Assessment[] {
    return (Object.values(this.snap.assessments) as Assessment[]).sort((a, b) => a.date.localeCompare(b.date));
  }

  assessmentFor(entryId: string): Assessment | null {
    // Direct lookup: with years of imported days, sorting on every call is too slow.
    return (Object.values(this.snap.assessments) as Assessment[]).find((a) => a.entryId === entryId) ?? null;
  }

  /** Assessments by entry id, for lists of many days. */
  assessmentsByEntry(): Map<string, Assessment> {
    return new Map((Object.values(this.snap.assessments) as Assessment[]).map((a) => [a.entryId, a]));
  }

  history(): HistoryDay[] {
    return buildHistory(this.entries(), this.assessments());
  }

  /** Saves an entry and its assessment. A new entry for the same evening replaces the old one. */
  async saveEntry(entry: Entry, assessment: Assessment): Promise<void> {
    const old = this.entryFor(entry.date);
    if (old && old.id !== entry.id) {
      const oldA = this.assessmentFor(old.id);
      delete this.snap.entries[old.id];
      await this.backend.remove('entries', old.id);
      if (oldA) {
        delete this.snap.assessments[oldA.id];
        await this.backend.remove('assessments', oldA.id);
      }
    }
    this.snap.entries[entry.id] = entry;
    this.snap.assessments[assessment.id] = assessment;
    await this.backend.put('entries', entry.id, entry);
    await this.backend.put('assessments', assessment.id, assessment);
    this.changed();
  }

  /** Replaces saved assessments, e.g. after "Räkna om historiken". Entries are not touched. */
  async saveAssessments(list: Assessment[]): Promise<void> {
    for (const a of list) {
      this.snap.assessments[a.id] = a;
      await this.backend.put('assessments', a.id, a);
    }
    this.changed();
  }

  // ---- export, import, wipe ----
  exportData(now = new Date()): ExportData {
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      data: JSON.parse(JSON.stringify(this.snap)),
    };
  }

  async importData(data: ExportData): Promise<void> {
    if (data.format !== EXPORT_FORMAT || typeof data.data !== 'object') throw new Error('Filen är inte en Dagsljus-export');
    if (data.version > EXPORT_VERSION) throw new Error('Exporten kommer från en nyare version av appen');
    await this.backend.replaceAll(data.data);
    this.snap = await this.backend.load();
    await this.migrate();
    this.changed();
  }

  async wipe(): Promise<void> {
    await this.backend.wipe();
    this.snap = await this.backend.load();
    this.changed();
  }
}
