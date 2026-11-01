// Core domain types for Dagsljus. All data lives on the device.

/** Calendar date in local time, formatted YYYY-MM-DD. */
export type DateKey = string;

export type Level = 'green' | 'yellow' | 'red';

/** Row categories in the crisis plan. Signs give points, actions are shown to the user. */
export type PlanItemKind =
  | 'early' // early sign, gives yellow
  | 'serious' // serious sign, gives red
  | 'action_yellow'
  | 'action_red'
  | 'relatives';

export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  text: string;
  /** Position within its kind; lower comes first. The first action is "the first step". */
  order: number;
  approvedAt: string;
}

export interface PlanSettings {
  /** The user's own description of their normal state, used as context. */
  normalState: string;
  /** Sleep below this many hours is an early sign. Default 5 per the spec. */
  sleepThresholdHours: number;
}

export type EntryKind = 'checkin' | 'heavy';

export type SleepSource = 'garmin' | 'transcript';

export interface Entry {
  id: string;
  /** The evening this entry belongs to. Entries made before 05:00 count to the previous evening. */
  date: DateKey;
  /** ISO timestamp of when the entry was saved. */
  createdAt: string;
  kind: EntryKind;
  /** Corrected transcript or typed text. Empty for "Orkar bara trycka". */
  transcript: string;
  mood: number | null;
  energy: number | null;
  /** Words per minute, only when speech was recorded and timed. */
  wordsPerMinute: number | null;
  /** Hours of sleep the night before, and where the value came from. */
  sleepHours: number | null;
  sleepSource: SleepSource | null;
  /** Daily average stress (Garmin, step 3). */
  stressAvg: number | null;
}

/** One day of measured values from the user's own Garmin account. */
export interface GarminDay {
  /** Garmin's calendar date. Sleep belongs to the morning the user woke up. */
  date: DateKey;
  sleepHours: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  /** Local wall-clock time "HH:MM" when the user fell asleep and woke up. */
  sleepStart: string | null;
  sleepEnd: string | null;
  /** Garmin's overall stress level for the day, 0-100. */
  stressAvg: number | null;
  /** Minutes in Garmin's high stress band. */
  stressHighMinutes: number | null;
  /** Body Battery at the first reading after waking. */
  bodyBatteryWake: number | null;
  fetchedAt: string;
}

export type SignalKind =
  | 'early_sign'
  | 'serious_sign'
  | 'sleep_low'
  | 'sleep_low_consecutive'
  | 'stress_high'
  | 'speech_fast'
  | 'night_entry'
  | 'silence'
  | 'mood_jump'
  | 'energy_jump'
  | 'heavy_day'
  | 'late_sleep_no_entry';

export interface Signal {
  kind: SignalKind;
  points: number;
  /** Human readable explanation in Swedish, using the user's own words where possible. */
  label: string;
  /** Plan item behind a matched sign. */
  planItemId?: string;
  /** Verbatim quote from the transcript supporting a matched sign. */
  quote?: string;
  /** True for measured (objective) signals. */
  measured: boolean;
}

export type MatchMethod = 'wordmatch' | 'llm' | 'llm_fallback' | 'none';

/** Which rule decided the level, so the app can explain it. */
export type LevelReason =
  | 'nothing' // 0 points: green
  | 'points' // 1-3 points: yellow
  | 'points_red' // 4 points or more
  | 'serious_plus_other' // a serious sign together with another sign
  | 'recent_days' // 2 points after several yellow or red days
  | 'measured_three'; // three measured signs the same day

export interface Assessment {
  id: string;
  entryId: string;
  date: DateKey;
  createdAt: string;
  level: Level;
  points: number;
  signals: Signal[];
  sentence: string;
  method: MatchMethod;
  /** Model name, when an LLM was used. */
  model: string | null;
  promptId: string | null;
  promptVersion: string | null;
  /** Baseline values used, for display. */
  baseline: Baseline;
  /** The rule that decided the level. Missing on assessments saved before it existed. */
  levelReason?: LevelReason;
  /** Yellow or red days in the week before, as used by the rule. */
  recentNonGreenDays?: number;
}

export interface Baseline {
  wordsPerMinute: number | null;
  stressAvg: number | null;
  greenDays: number;
}

export interface SignMatch {
  planItemId: string;
  quote: string;
}

export interface AppSettings {
  /** Names to remove before text is sent anywhere (partner, parents, care contact...). */
  scrubNames: string[];
  reminderEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
  appLockEnabled: boolean;
  onboardingDone: boolean;
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  normalState: '',
  sleepThresholdHours: 5,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  scrubNames: [],
  reminderEnabled: false,
  reminderHour: 21,
  reminderMinute: 0,
  appLockEnabled: true,
  onboardingDone: false,
};
