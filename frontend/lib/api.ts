/**
 * API client — thin wrapper around fetch.
 * Token stored in localStorage; all requests go to /api/* via Next.js proxy.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("hc_token");
}

export function saveToken(token: string) {
  localStorage.setItem("hc_token", token);
}

export function clearToken() {
  localStorage.removeItem("hc_token");
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Ej autentiserad");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(password: string): Promise<string> {
  const data = await request<{ access_token: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  saveToken(data.access_token);
  return data.access_token;
}

// ── Diary ─────────────────────────────────────────────────────────────────────

export type MoodLevel = "Balanserad" | "Lite" | "Mycket" | null;

export interface DiaryEntry {
  id: number;
  date: string;
  mood_high: MoodLevel;
  mood_low: MoodLevel;
  medicin: boolean | null;
  mindfulness: boolean | null;
  traning: boolean | null;
  bad_kallbad: boolean | null;
  utomhus_pa_lunchen: boolean | null;
  sluta_jobb_i_tid: boolean | null;
  jobba_30min_timer: boolean | null;
  anvant_sork: boolean | null;
  ekonomiskt_hallbart_val: boolean | null;
  psykolog: boolean | null;
  kanner_mig_mindful: boolean | null;
  somnavvikelse: boolean | null;
  alkohol: boolean | null;
  handlat_mer_an_vanligt: boolean | null;
  stress_symptom: boolean | null;
  angest: boolean | null;
  stor_oro: boolean | null;
  hogt_engagemang: boolean | null;
  allt_bara_funkar: boolean | null;
  hog_energi: boolean | null;
  jag_mar_antligen_bra: boolean | null;
  hogt_sjalvfortroende: boolean | null;
  lyssnar_hetsig_musik: boolean | null;
  upplevd_bradska: boolean | null;
  upplevt_magstodd: boolean | null;
  energi_flodar: boolean | null;
  manga_ideer: boolean | null;
  svart_att_vanta: boolean | null;
  ser_sammanhang: boolean | null;
  handlat_ovanligt: boolean | null;
  jag_ar_smartare: boolean | null;
  spontan_inlagg: boolean | null;
  dofter_tydligare: boolean | null;
  maste_bromsa_hjarnan: boolean | null;
  nat_bra_hant: boolean | null;
  nat_daligt_hant: boolean | null;
  lakarbesok: boolean | null;
  social_aktivitet: boolean | null;
  leta_efter_information: boolean | null;
  anteckningar: string | null;
  mania_score: number;
  depression_score: number;
  garmin_data?: GarminData | null;
}

export type DiaryEntryInput = Partial<Omit<DiaryEntry, "id" | "mania_score" | "depression_score" | "garmin_data">>;

export async function getDiaryEntries(params?: {
  date_from?: string;
  date_to?: string;
  limit?: number;
}): Promise<DiaryEntry[]> {
  const q = new URLSearchParams();
  if (params?.date_from) q.set("date_from", params.date_from);
  if (params?.date_to) q.set("date_to", params.date_to);
  if (params?.limit) q.set("limit", String(params.limit));
  return request<DiaryEntry[]>(`/api/diary/?${q}`);
}

export async function getDiaryEntry(date: string): Promise<DiaryEntry> {
  return request<DiaryEntry>(`/api/diary/${date}`);
}

export async function upsertDiaryEntry(date: string, data: DiaryEntryInput): Promise<DiaryEntry> {
  return request<DiaryEntry>(`/api/diary/${date}`, {
    method: "PUT",
    body: JSON.stringify({ date, ...data }),
  });
}

export async function patchDiaryEntry(date: string, data: DiaryEntryInput): Promise<DiaryEntry> {
  return request<DiaryEntry>(`/api/diary/${date}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getFilledDates(params?: {
  date_from?: string;
  date_to?: string;
}): Promise<string[]> {
  const q = new URLSearchParams();
  if (params?.date_from) q.set("date_from", params.date_from);
  if (params?.date_to) q.set("date_to", params.date_to);
  return request<string[]>(`/api/diary/dates?${q}`);
}

// ── Garmin ────────────────────────────────────────────────────────────────────

export interface GarminData {
  id: number;
  date: string;
  total_sleep_minutes: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  sleep_score: number | null;
  hrv_last_night: number | null;
  resting_heart_rate: number | null;
  avg_stress: number | null;
  body_battery_start: number | null;
  body_battery_end: number | null;
  steps: number | null;
}

export interface GarminStatus {
  last_sync: string | null;
  credentials_configured: boolean;
  message: string;
}

export async function getGarminStatus(): Promise<GarminStatus> {
  return request<GarminStatus>("/api/garmin/status");
}

export async function setupGarmin(username: string, password: string): Promise<void> {
  return request("/api/garmin/setup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function syncGarmin(dateFrom?: string, dateTo?: string): Promise<{ message: string; synced_count: number }> {
  return request("/api/garmin/sync", {
    method: "POST",
    body: JSON.stringify({ date_from: dateFrom, date_to: dateTo }),
  });
}

export async function getGarminData(params?: { date_from?: string; date_to?: string }): Promise<GarminData[]> {
  const q = new URLSearchParams();
  if (params?.date_from) q.set("date_from", params.date_from);
  if (params?.date_to) q.set("date_to", params.date_to);
  return request<GarminData[]>(`/api/garmin/data?${q}`);
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface AnalysisReport {
  summary: string;
  period_days: number;
  filled_days: number;
  patterns: Array<{ title: string; description: string; supporting_dates: string[] }>;
  garmin_correlations: Array<{ title: string; description: string; supporting_dates: string[] }>;
  early_warning_signals: Array<{ title: string; description: string; supporting_dates: string[] }>;
  protective_factors: Array<{ title: string; description: string; supporting_dates: string[] }>;
  recommendations: string[];
  warnings: Array<{ severity: string; description: string; recommendation: string }>;
  disclaimer: string;
}

export interface AnalysisResponse {
  report: AnalysisReport;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  from_cache: boolean;
  generated_at: string;
}

export async function runAnalysis(
  dateFrom: string,
  dateTo: string,
  forceRefresh = false
): Promise<AnalysisResponse> {
  return request<AnalysisResponse>("/api/analysis/", {
    method: "POST",
    body: JSON.stringify({ date_from: dateFrom, date_to: dateTo, force_refresh: forceRefresh }),
  });
}

// ── CSV Import ────────────────────────────────────────────────────────────────

export interface CSVPreviewResponse {
  total_rows: number;
  parseable_rows: number;
  parse_errors: Array<{ row?: number; error?: string; warning?: string }>;
  preview: Array<{ row_number: number; date: string; already_exists: boolean; data: Record<string, string | null> }>;
}

export interface CSVImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; date: string; error: string }>;
}

export async function previewCSV(file: File): Promise<CSVPreviewResponse> {
  const form = new FormData();
  form.append("file", file);
  return request<CSVPreviewResponse>("/api/import/preview", { method: "POST", body: form, headers: {} });
}

export async function commitCSV(file: File, onConflict: "skip" | "overwrite" | "abort"): Promise<CSVImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("on_conflict", onConflict);
  return request<CSVImportResult>("/api/import/commit", { method: "POST", body: form, headers: {} });
}
