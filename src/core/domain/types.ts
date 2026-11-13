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

export type DagligtKind = 'medication_taken' | 'event' | 'correction' | 'routine_done' | 'red_step';

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
  /** grund: the crisis plan block the row was made from. */
  blockId?: string | null;
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
  /** How often the routine should be done. Missing: read from the routine's words, else every day. */
  frequency?: RoutineFrequency | null;
}

/**
 * How often a routine should be done: every day, a number of times a week (any days), or on
 * given weekdays (1 Monday … 7 Sunday). Weeks run Monday to Sunday.
 */
export type RoutineFrequency =
  | { kind: 'daily' }
  | { kind: 'weekly'; times: number }
  | { kind: 'weekdays'; days: number[] };

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
  medication_taken: 'dagligt', event: 'dagligt', correction: 'dagligt', routine_done: 'dagligt', red_step: 'dagligt',
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
  /** Stämning from −3 (Akut depression) to +3 (Akut mani); see analysis/mood.ts. */
  mood: number | null;
  /** Stämning on the old 1–10 scale, kept on entries saved before the scale changed (schema 4). */
  moodTen?: number | null;
  /** An imported day whose mood was read again from the diary's words (schema 6): what it was, and when. */
  moodReread?: { was: number; at: string } | null;
  /** Energy 1–10. */
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
  /** "HH:MM" of the watch's last reading when the check-in was saved. Far before the check-in: the watch had not synced. */
  measuredUntil?: string | null;
  /** Seconds the check-in took, from the first touch to saving. */
  durationSec?: number | null;
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
  /** "HH:MM" of the day's last reading from the watch (Garmin's Body Battery). Shows how far the watch has synced. */
  dataUntil?: string | null;
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
  | 'mood_rated'
  | 'text_pattern'
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
  /** Which way a rating points (stämning): up towards mania, down towards depression. */
  polarity?: 'up' | 'down';
  /** Weighs as a serious sign: the plan's steps at red show, and with another sign the day is red. Stämning ±3. */
  serious?: boolean;
  /** A personal text pattern (Mina tidigare texter) behind this signal. */
  patternId?: string;
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
  | 'excused' // would be red only through sleep or stress after alcohol, illness or hard training yesterday: yellow
  | 'text_alone' // would be red, but nothing else than personal text patterns gave points: yellow
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
  /** Why the match was mild: a negation ("vill inte dö"), or the past, someone else or a topic. */
  akutMildBecause?: 'negation' | 'context';
  /** Neutral lines on a green day: sleep or stress moved the wrong way three days in a row, still within the limit. No points, no colour. */
  trend?: string[];
  /** B7: word matching's result, shown because the model had not answered within the budget. Cleared when its answer is saved. */
  awaitingModel?: boolean;
  /** Everything the assessment was computed from, so it can be computed again. Missing on assessments saved before it existed. */
  inputs?: AssessmentInputs;
  /** Set when the level was computed again with newer rules: what it was before. */
  recomputed?: { at: string; fromRulesVersion: string | null; level: Level; points: number } | null;
  /** Set when the day was computed again with values the watch synced later: what it was before. */
  remeasured?: { at: string; level: Level; points: number; changes: string[] } | null;
  /** The person kept the day as it was although the watch's later values gave this. */
  remeasureDeclined?: { at: string; level: Level; points: number } | null;
  /** Mina tidigare texter: what the comparison with the person's earlier texts found and changed. */
  textPatterns?: TextComparison | null;
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
  /** With a model: serious signs word matching found and the model left out. They count anyway. */
  keptByPhone?: SignMatch[];
  /** With a model: other signs word matching found and the model did not count. Shown, not counted. */
  wordOnly?: SignMatch[];
  /** The model's sentence, when it was not used because it did not mention what gave points. */
  sentenceDropped?: string | null;
  /** Observations of personal text patterns that passed the checks on the phone (Mina tidigare texter). */
  textObservations?: TextObservationInput[];
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
  /**
   * The plan's routines at early signs are followed: the person turned it on because the signs
   * point up or down. Their routines then show in "Rutiner i dag" next to the daily ones.
   */
  planMode?: { direction: 'up' | 'down'; since: DateKey } | null;
  /** Kontroll över signaler: no notices of the app's own between these times ("HH:MM"). */
  quietHours?: { start: string; end: string } | null;
  /** How often proposals and the profile review show on the home screen. */
  suggestionPace?: SuggestionPace;
  /** Lågt läge: only the check-in and Hjälp nu are shown. */
  lowMode?: boolean;
  /** Första veckan: the day the person started; the earliest entry for those who started before it existed. */
  firstUseAt?: DateKey | null;
  /** Första veckan: the sleep source suggestion and the first week picture have been answered. */
  firstWeekDone?: { sleepSource?: boolean; weekPicture?: boolean };
  /** Mina tidigare texter: compare the evening's note with approved personal patterns. Set after the preview. */
  textPatterns?: { enabled: boolean; consentAt: string | null } | null;
  /** The day's routine suggestion on Hem worded by the language model. Missing: on when a model is set up. */
  routineSuggestions?: boolean;
  /** The person's own name in message files, so only their own lines are imported. */
  ownMessageName?: string | null;
}

/** direct: as soon as there is one. weekly: on Mondays. visit: only under Inför återbesök. */
export type SuggestionPace = 'direct' | 'weekly' | 'visit';

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

// ---- Mina tidigare texter (experimental, personal use) ----

/** How the person labelled the period a text comes from. A label is the person's judgement, never a certainty. */
export type PeriodType = 'stable' | 'up' | 'down' | 'mixed' | 'unsure';
/** Who made the label: the person afterwards, or together with the care. */
export type LabelSource = 'self_after' | 'with_care';
export type ReferenceTextType = 'diary' | 'message' | 'work' | 'other';

/** A text the person wrote earlier, kept as reference material. Historical data, never instructions. */
export interface ReferenceText {
  id: string;
  text: string;
  /** Approximate date: "2024", "2024-03" or "2024-03-12". */
  approxDate: string | null;
  /** The person's own name for the period, so several texts can share it ("vår 2024"). */
  periodId: string;
  periodType: PeriodType;
  labelSource: LabelSource;
  textType: ReferenceTextType;
  comment: string | null;
  /** May the text be used in the analysis. Off: kept, never sent, never used. */
  useInAnalysis: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PatternDirection = 'up' | 'down' | 'mixed' | 'unclear';
/** What a pattern is about, so it is never counted again as a plan sign or a measured value of the same kind. */
export type Phenomenon = 'sleep' | 'activity' | 'mood' | 'speech' | 'social' | 'self_worth' | 'thinking' | 'other';

export interface PatternEvidence {
  refId: string;
  /** Word for word from the reference text, checked on the phone. */
  quote: string;
}

/**
 * A recurring pattern in the person's earlier texts, proposed by the model with quotes. Used
 * only after the person approves it, and then experimentally: approval is not clinical validation.
 */
export interface TextPattern {
  id: string;
  description: string;
  direction: PatternDirection;
  phenomenon: Phenomenon;
  evidence: PatternEvidence[];
  counterExamples: (PatternEvidence & { note: string | null })[];
  alternatives: string[];
  /** A plan sign the pattern is the same as, when there is one: then the sign counts, never the pattern too. */
  planSignId: string | null;
  /** needs_review: some of its sources were removed or turned off; not used until approved again. */
  status: 'proposed' | 'approved' | 'rejected' | 'needs_review';
  createdAt: string;
  decidedAt: string | null;
  model: string | null;
  promptVersion: string | null;
  /** The reference material it was proposed from. */
  referenceVersion: string;
  /** How many times the person has said an observation of it did not fit. Shown, never acted on by itself. */
  rejectedObservations?: number;
}

/** Whose experience a quote is about. Only self_now can give points. */
export type Perspective = 'self_now' | 'history' | 'other_person' | 'quote_or_hypothetical' | 'humor_or_irony' | 'text_context';

/** An observation that passed the checks on the phone and may count, if the rules let it. */
export interface TextObservationInput {
  patternId: string;
  quote: string;
  direction: PatternDirection;
  phenomenon: Phenomenon;
  planSignId: string | null;
  description: string;
  /** Reference texts the model compared with. */
  referenceIds: string[];
  note: string;
}

export interface TextObservationResult extends TextObservationInput {
  perspective: Perspective;
  /** True when the observation gave a point today. */
  counted: boolean;
  /** Why it did not count, in plain words. */
  reason: string | null;
  /** The person said it did not fit. */
  rejectedAt?: string | null;
}

/** What Mina tidigare texter did to one assessment, saved so its effect can be reviewed afterwards. */
export interface TextComparison {
  rulesVersion: string;
  model: string | null;
  promptId: string;
  promptVersion: string;
  referenceVersion: string;
  referenceIds: string[];
  patternIds: string[];
  abstained: boolean;
  abstainReason: string | null;
  observations: TextObservationResult[];
  differences: string[];
  uncertainties: string[];
  /** No stable-period texts in the comparison: said in the result. */
  stableMissing: boolean;
  /** The level and points the day would have had without personal text patterns. */
  levelWithout: Level;
  pointsWithout: number;
  /** The model call failed: nothing counted. */
  error?: string | null;
}
