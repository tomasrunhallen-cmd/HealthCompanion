// Core domain types for Dagsljus. All data lives on the device.

import { RULES } from '../analysis/rules';

/** Calendar date in local time, formatted YYYY-MM-DD. */
export type DateKey = string;

export type Level = 'green' | 'yellow' | 'red';

/** Row categories in the crisis plan. Signs give points, actions are shown to the user. */
export type PlanItemKind =
  | 'early' // early sign, gives yellow
  | 'serious' // serious sign, gives red
  | 'action_yellow'
  | 'action_red'
  | 'relatives'
  | 'akut'; // the user's own emergency phrases: matched in code, never sent to a model

// ---- The crisis plan's rows, as crisis plans are built ----

/** What a row in the plan is. */
export type RowKind = 'sign' | 'trigger' | 'action' | 'routine' | 'contact' | 'value_anchor' | 'wish' | 'note_for_care' | 'ignore';
/** Which way a row points: up (the plan may call it mani), down (depression), or both. */
export type Polarity = 'up' | 'down' | 'both';

export interface PlanFields {
  kind: RowKind;
  polarity: Polarity;
  /** Only for sign. */
  severity?: 'early' | 'serious';
  /** Only for sign: the person's own experience, or what others can see. */
  observer?: 'self' | 'others';
  /** Only for action. */
  when?: 'early' | 'serious' | 'always';
  /** Only for action. */
  who?: 'me' | 'relative' | 'care';
  /** Only for action: the step number when the plan describes a ladder ("om jag inte lyssnar …"). */
  order?: number | null;
  /** The plan's own heading chain, e.g. "Tidiga varningstecken > Egna upplevelser/tecken av mani". */
  sourceHeading?: string;
}

export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  text: string;
  /** The row's fields; rows saved before the fields existed get them by migration. */
  plan?: PlanFields;
  /** Position within its kind; lower comes first. The first action is "the first step". */
  order: number;
  /** Null for standard content the user has not confirmed yet. */
  approvedAt: string | null;
  /** Where the row came from. Rows saved before the context bank have none. */
  origin?: ContextOrigin;
}

// ---- Context bank: what the app knows about the user, kept apart from prompts and model ----

/** grund: changed only by the user. profil: changed through approved suggestions. dagligt: day to day. */
export type ContextLayer = 'grund' | 'profil' | 'dagligt';

export type ContextOrigin = 'standard' | 'crisis_plan' | 'user' | 'suggested' | 'correction';

export type GrundKind =
  | PlanItemKind
  | 'trigger' // utlösare: resor, sömnbrist, årstid, konflikter, alkohol
  | 'false_alarm' // kända falsklarm
  | 'medication' // medicin och dosändringar
  | 'tone_yellow' // önskad ton vid gult
  | 'tone_red' // önskad ton vid rött
  | 'routine' // livsstil och rutiner
  | 'contact' // kontakter: mottagningar, personer, nummer
  | 'value_anchor' // värdeankare, visas ordagrant
  | 'wish' // patientens önskemål: aldrig i bedömningen, aldrig till en modell
  | 'note_for_care'; // till vården, t.ex. rekommendationer: aldrig i bedömningen, aldrig till en modell

export type ProfilKind =
  | 'normal_state' // normalläge i egna ord
  | 'typical_phrase' // typiska formuleringar på vanliga dagar
  | 'period_low' // tidigare nedstämd period
  | 'period_high' // tidigare uppvarvad period
  | 'period_mixed' // tidigare blandad period
  | 'course'; // känt förlopp: vilket tecken som kommer först, dagar till nästa

export type DagligtKind = 'medication_taken' | 'event' | 'correction' | 'routine_done';

export type ContextKind = GrundKind | ProfilKind | DagligtKind;

export interface Correction {
  assessmentId: string;
  /** "Stämmer" or "Stämmer inte". */
  verdict: 'agree' | 'disagree';
  /** The plan sign the correction is about, when it is about one. */
  planItemId?: string | null;
}

export interface ContextEntry {
  id: string;
  layer: ContextLayer;
  kind: ContextKind;
  text: string;
  /** Position within its kind; lower comes first. */
  order: number;
  origin: ContextOrigin;
  createdAt: string;
  /** When the user approved or confirmed it. Null for unconfirmed standard content. */
  approvedAt: string | null;
  /** dagligt: the day it belongs to (an event's date, a day's medication, a correction's day). */
  date?: DateKey | null;
  /** dagligt, kind medication_taken. */
  taken?: boolean | null;
  /** dagligt, kind correction. */
  correction?: Correction | null;
  /** Set on entries created by an import from another diary, so the import can be undone. */
  importId?: string | null;
  /** grund: the crisis plan row's fields. The entry's kind follows from them. */
  plan?: PlanFields | null;
  /** grund, kind routine: whether it is logged in the evening check-in, and a daily reminder time. */
  routine?: RoutineSettings | null;
  /** dagligt, kind routine_done: the routine it is about, and whether it was done that day. */
  routineId?: string | null;
  done?: boolean | null;
}

export interface RoutineSettings {
  /** Asked about in the evening check-in. */
  track: boolean;
  /** "HH:MM", a daily reminder on the phone. Null: no reminder. */
  reminder: string | null;
}

/**
 * A change the app proposes to the context bank. Nothing in it touches the bank until the
 * user approves it. Kept apart from the bank, in its own list.
 */
export interface Suggestion {
  id: string;
  /** Same key = same proposal; only one can be pending at a time. */
  key: string;
  type: 'false_alarm' | 'own_sign' | 'profile' | 'course';
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
  /** What approving does. */
  change: {
    action: 'add' | 'update' | 'remove' | 'confirm';
    kind: ContextKind;
    text: string;
    /** For update, remove and confirm. */
    targetId?: string | null;
  };
  /** Why, in plain Swedish. */
  reason: string;
  /** Verbatim quotes the proposal rests on. */
  quotes: string[];
  source: 'corrections' | 'profile_update';
}

export const PLAN_KINDS: PlanItemKind[] = ['early', 'serious', 'action_yellow', 'action_red', 'relatives', 'akut'];

export const LAYER_OF: Record<ContextKind, ContextLayer> = {
  early: 'grund', serious: 'grund', action_yellow: 'grund', action_red: 'grund', relatives: 'grund', akut: 'grund',
  trigger: 'grund', false_alarm: 'grund', medication: 'grund', tone_yellow: 'grund', tone_red: 'grund',
  routine: 'grund', contact: 'grund', value_anchor: 'grund', wish: 'grund', note_for_care: 'grund',
  normal_state: 'profil', typical_phrase: 'profil', period_low: 'profil', period_high: 'profil',
  period_mixed: 'profil', course: 'profil',
  medication_taken: 'dagligt', event: 'dagligt', correction: 'dagligt', routine_done: 'dagligt',
};

export interface PlanSettings {
  /** The user's own description of their normal state, used as context. */
  normalState: string;
  /** Sleep below this many hours is an early sign. Default 5 per the spec. */
  sleepThresholdHours: number;
  /** The plan's own words for the two directions, when the plan uses them ("Mani", "Depression"). */
  polarityWords?: { up?: string; down?: string } | null;
  /** The plan's sleep window ("Sömn 22:30–07:00"), used by the sleep rules once the person approves it. */
  sleepWindow?: { start: string; end: string } | null;
}

/** imported: a day brought in from another mood diary; it has no clock time. */
export type EntryKind = 'checkin' | 'heavy' | 'imported';

/** Where sleep and stress came from. manual: the person's own entry; health: Apple Hälsa or Health Connect. */
export type MeasureSource = 'garmin' | 'health' | 'manual';
/** transcript: estimated from "sov sex timmar" in the note. */
export type SleepSource = MeasureSource | 'transcript';

export interface Entry {
  id: string;
  /** The day this entry belongs to, 04:00–04:00 local time. An entry at 00:30 counts to the day before. */
  date: DateKey;
  /** ISO timestamp of when the entry was saved. */
  createdAt: string;
  /** "HH:MM" on the phone's clock where the entry was made. Keeps the hour when the phone later changes time zone. */
  localTime?: string | null;
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
  /** Where the day's stress came from. Missing on entries saved before sources existed: those are Garmin. */
  stressSource?: MeasureSource | null;
  /** Daily average stress (Garmin, step 3). */
  stressAvg: number | null;
  /** "Alkohol, sjuk eller hård träning i går?" Yes: the sleep and stress rules give 0 points that day. */
  strainYesterday?: boolean | null;
  /** Days brought in from another diary: which import, and the day's original values. */
  imported?: ImportedFrom;
}

export interface ImportedFrom {
  importId: string;
  source: ImportSource;
  /** The original row's filled-in values, column by column, except the note. */
  values: Record<string, string>;
}

export type ImportSource = 'bipolar-dagbok';

/** One day of measured values from the user's own Garmin account. */
/**
 * One day of sleep and stress, whatever the source (B5). Sleep belongs to the morning the
 * person woke up. A day merged from several sources says where its sleep and stress came from.
 */
export interface MeasuredDay {
  /** Where the sleep values come from. Missing: Garmin (saved before sources existed). */
  source?: MeasureSource;
  /** Where the stress values come from, when not the same as the sleep. */
  stressSource?: MeasureSource;
  /** The calendar date. Sleep belongs to the morning the user woke up. */
  date: DateKey;
  sleepHours: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  /** Local wall-clock time "HH:MM" when the user fell asleep and woke up. */
  sleepStart: string | null;
  sleepEnd: string | null;
  /** Stress for the day, 0-100 on Garmin's scale. A manual entry (låg, medel, hög) is 25, 50 or 75. */
  stressAvg: number | null;
  /** Minutes in the high stress band (Garmin only). */
  stressHighMinutes: number | null;
  /** Body Battery at the first reading after waking. */
  bodyBatteryWake: number | null;
  fetchedAt: string;
}

/** The name the Garmin code has always used for the same format. */
export type GarminDay = MeasuredDay;

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
  | 'late_sleep_no_entry'
  | 'medication_missed'
  | 'akut';

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
  /** From a standard row the user has not confirmed: it may give yellow, never red. */
  unconfirmedStandard?: boolean;
  /** A measured sign that was also there the day before; only then can it count towards red. */
  persistent?: boolean;
  /** Counted as 0: alcohol, illness or hard training the day before. */
  excused?: boolean;
  /** Reduced by the daily cap on measured signs. */
  capped?: boolean;
}

/** import: signs came from the user's own mapping of another diary's columns, plus word matching. */
export type MatchMethod = 'wordmatch' | 'llm' | 'llm_fallback' | 'none' | 'import';

/** Which rule decided the level, so the app can explain it. */
export type LevelReason =
  | 'nothing' // 0 points: green
  | 'points' // 1-3 points: yellow
  | 'points_red' // 4 points or more
  | 'serious_plus_other' // a serious sign together with another sign
  | 'recent_days' // 2 points after several yellow or red days
  | 'measured_three' // old rule, kept to explain assessments saved before it was removed
  | 'measured_first_day' // would be red only through measured signs that were not there the day before: yellow
  | 'standard_cap' // would be red only through unconfirmed standard rows: yellow
  | 'akut'; // the note matched the emergency word list

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
  /** The note matched the emergency word list: crisis numbers shown, note not sent to a model. */
  akut?: boolean;
  /** A match with a negation ("vill inte dö"): a gentler crisis card, level unchanged, note not sent to a model. */
  akutMild?: boolean;
  /** Neutral lines on a green day: sleep or stress moved the wrong way three days in a row, still within the limit. No points, no colour. */
  trend?: string[];
  /** B7: word matching's result, shown because the model had not answered within the budget. Cleared when its answer is saved. */
  awaitingModel?: boolean;
  /** Everything the assessment was computed from, so it can be computed again. Missing on assessments saved before it existed. */
  inputs?: AssessmentInputs;
  /** Set when the level was computed again with newer rules: what it was before. */
  recomputed?: { at: string; fromRulesVersion: string | null; level: Level; points: number } | null;
}

/**
 * All input to one assessment (B3). With it the level can be computed again with new rules,
 * and anyone can see exactly what the app knew. The note appears only as it was sent to a
 * model, scrubbed; word matching on the phone sends nothing.
 */
export interface AssessmentInputs {
  /** rules/rules.json version the level was computed with. */
  rulesVersion: string;
  /** The note as sent to a language model, scrubbed. Null when nothing was sent. */
  sentText: string | null;
  /** The model's answer as it came back, before any check. Null for word matching. */
  rawAnswer: string | null;
  /** The signs the note was compared with, in prompt order. */
  signs: PlanItem[];
  /** The signs that matched, with quotes, as the scoring used them. */
  matches: SignMatch[];
  planSettings: Pick<PlanSettings, 'sleepThresholdHours'>;
  /** Measured days used by the rules: this day and the days before it that the rules look at. */
  garmin: Record<DateKey, GarminDay>;
  /** Medication answers per day, as used by the rule. */
  medication: Record<DateKey, boolean>;
  baseline: Baseline;
}

export interface Baseline {
  wordsPerMinute: number | null;
  stressAvg: number | null;
  greenDays: number;
  /** Average sleep on green days (Garmin or estimated). */
  sleepHours?: number | null;
  /** Usual time of the evening check-in, "HH:MM". */
  entryTime?: string | null;
  /** The Monday the baseline was computed for: it is recomputed once a week. */
  weekOf?: DateKey;
}

export interface SignMatch {
  planItemId: string;
  quote: string;
}

/** unset: first start, not chosen yet. standard: started with the app's standard content. own: own crisis plan. */
export type ContextMode = 'unset' | 'standard' | 'own';

export interface AppSettings {
  /** Names to remove before text is sent anywhere (partner, parents, care contact...). */
  scrubNames: string[];
  reminderEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
  appLockEnabled: boolean;
  onboardingDone: boolean;
  contextMode: ContextMode;
  /** When the user chose to start with standard content. */
  standardSince: string | null;
  /** Week number (since standardSince) of the last dismissed reminder to replace standard content. */
  standardNudgeDismissedWeek: number | null;
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  normalState: '',
  sleepThresholdHours: RULES.sleepThresholdHoursDefault,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  scrubNames: [],
  reminderEnabled: false,
  reminderHour: 21,
  reminderMinute: 0,
  appLockEnabled: true,
  onboardingDone: false,
  contextMode: 'unset',
  standardSince: null,
  standardNudgeDismissedWeek: null,
};
