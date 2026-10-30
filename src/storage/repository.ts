// The app's single source of data. Keeps a cache in memory and writes through to the backend.

import { buildHistory, type HistoryDay } from '../analysis/scoring';
import {
  DEFAULT_APP_SETTINGS, DEFAULT_PLAN_SETTINGS,
  type AppSettings, type Assessment, type DateKey, type Entry, type GarminDay, type PlanItem, type PlanItemKind, type PlanSettings,
} from '../domain/types';
import { addDays } from '../analysis/dates';
import type { SentRequest, Usage } from '../adapter/types';
import { addUsage, DEFAULT_LLM_CONFIG, pruneUsage, type LlmConfig, type UsageLog } from '../llm/config';
import type { DocBackend, Snapshot, StorageInfo } from './backend';

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

export class Repository {
  private snap!: Snapshot;
  private listeners = new Set<Listener>();
  /** Bumps on every change so React can re-render. */
  revision = 0;

  private constructor(private backend: DocBackend) {}

  static async create(backend: DocBackend): Promise<Repository> {
    const r = new Repository(backend);
    r.snap = await backend.load();
    return r;
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

  planSettings(): PlanSettings {
    return { ...DEFAULT_PLAN_SETTINGS, ...(this.snap.kv.planSettings as Partial<PlanSettings> | undefined) };
  }

  async updatePlanSettings(patch: Partial<PlanSettings>): Promise<void> {
    const next = { ...this.planSettings(), ...patch };
    this.snap.kv.planSettings = next;
    await this.backend.put('kv', 'planSettings', next);
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

  // ---- crisis plan ----
  plan(): PlanItem[] {
    return (Object.values(this.snap.plan) as PlanItem[]).sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.order - b.order,
    );
  }

  planOf(kind: PlanItemKind): PlanItem[] {
    return this.plan().filter((p) => p.kind === kind).sort((a, b) => a.order - b.order);
  }

  /** Adds approved rows at the end of their category. */
  async addPlanItems(rows: { kind: PlanItemKind; text: string; id: string }[]): Promise<void> {
    const now = new Date().toISOString();
    for (const row of rows) {
      const order = this.planOf(row.kind).reduce((m, p) => Math.max(m, p.order + 1), 0);
      const item: PlanItem = { id: row.id, kind: row.kind, text: row.text.trim(), order, approvedAt: now };
      this.snap.plan[item.id] = item;
      await this.backend.put('plan', item.id, item);
    }
    this.changed();
  }

  async updatePlanItem(id: string, text: string): Promise<void> {
    const item = this.snap.plan[id] as PlanItem | undefined;
    if (!item) return;
    const next = { ...item, text: text.trim(), approvedAt: new Date().toISOString() };
    this.snap.plan[id] = next;
    await this.backend.put('plan', id, next);
    this.changed();
  }

  async removePlanItem(id: string): Promise<void> {
    delete this.snap.plan[id];
    await this.backend.remove('plan', id);
    this.changed();
  }

  /** Moves an item one step up or down within its category. */
  async movePlanItem(id: string, dir: -1 | 1): Promise<void> {
    const item = this.snap.plan[id] as PlanItem | undefined;
    if (!item) return;
    const list = this.planOf(item.kind);
    const idx = list.findIndex((p) => p.id === id);
    const other = list[idx + dir];
    if (!other) return;
    const a = { ...item, order: other.order };
    const b = { ...other, order: item.order };
    this.snap.plan[a.id] = a;
    this.snap.plan[b.id] = b;
    await this.backend.put('plan', a.id, a);
    await this.backend.put('plan', b.id, b);
    this.changed();
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
    return this.assessments().find((a) => a.entryId === entryId) ?? null;
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
    this.changed();
  }

  async wipe(): Promise<void> {
    await this.backend.wipe();
    this.snap = await this.backend.load();
    this.changed();
  }
}
