// The thresholds and points for the traffic light, read from rules/rules.json (bundled by
// scripts/build-prompts.js) and checked against rules/rules.schema.json. The level is decided
// with these rules, in code, never by a language model (principle 6). rules/README.md
// explains every rule in plain Swedish for a clinical reviewer.

import { validate, type SchemaNode } from '../llm/schema';
import { RULES_SCHEMA, RULES_SOURCE } from '../prompts/bundle.generated';

export interface Rules {
  version: string;
  points: {
    earlySign: number;
    seriousSign: number;
    measured: number;
    silence: number;
    jump: number;
    heavyDay: number;
    /** Fell asleep after lateSleepHour with no entry the evening before. */
    lateSleepNoEntry: number;
    /** "Nej" to the medication question medicationMissedDays evenings in a row. */
    medicationMissed: number;
    /** Stämning rated at ±2 (Depression, Uppvarvning). */
    moodModerate: number;
    /** Stämning rated at ±3 (Akut depression, Akut mani). */
    moodSevere: number;
  };
  level: {
    yellowAt: number;
    redAt: number;
    /** A serious sign together with at least this many signs in all gives red. */
    seriousPlusOtherSigns: number;
    /** Red at this many points when enough recent days were yellow or red. */
    redWithHistoryAt: number;
    historyWindowDays: number;
    historyNonGreenDays: number;
  };
  /** Measured signs give at most this many points together per day. */
  measuredCapPerDay: number;
  /**
   * Whether sleep and stress after "ja" to alcohol, illness or hard training yesterday can
   * count towards red. False: they still count, and show, but only towards yellow.
   */
  excusedMeasuredToRed: boolean;
  /**
   * Mina tidigare texter, an experimental product assumption: an approved personal pattern with
   * a checked quote in today's note gives `points`, at most `capPerDay` a day from distinct
   * phenomena. Without other signs they never give red.
   */
  textPatterns: { points: number; capPerDay: number; aloneCanGiveRed: boolean };
  /**
   * Dygnsrytm, experimental: the passive model on sleep timing and activity over the day
   * (src/core/analysis/rhythm.ts). Every threshold was set before any evaluation on real data.
   */
  rhythm: RhythmRules;
  /** Sleep below this is a sign until the person sets an own limit. */
  sleepThresholdHoursDefault: number;
  /** Stress at or above this (Garmin's scale 0–100, which the manual steps follow) ... */
  stressHighAt: number;
  /** ... this many days in a row, today included, is a sign. */
  stressHighDays: number;
  speechFastFraction: number;
  lateSleepHour: number;
  lateSleepLatestHour: number;
  /** Entries from 00:00 up to (not including) this hour are a sign. */
  nightEntryEndHour: number;
  silenceDays: number;
  medicationMissedDays: number;
  jumpThreshold: number;
  /** The same for stämning, on its scale from −3 to +3. */
  moodJumpThreshold: number;
  jumpWindowDays: number;
  jumpMinSamples: number;
  baselineWindowDays: number;
  baselineMinSamples: number;
  /** Days in a row for the neutral trend line on green days. */
  trendDays: number;
  /** The day runs from this hour to the same hour the next day, local time. */
  dayStartHour: number;
}

export interface RhythmRules {
  /** Points for a change with support for a direction, when the person has chosen to use it. */
  points: number;
  /** False: the passive signal can never decide red. */
  aloneCanGiveRed: boolean;
  /** The baseline looks this many days back ... */
  baselineDays: number;
  /** ... but leaves out the latest days, so a slow drift does not become the new normal. */
  baselineGapDays: number;
  /** Nights the baseline needs before the model says anything. */
  baselineMinNights: number;
  /** Nights in a row a change must show. */
  windowNights: number;
  /** ... found among this many latest nights: one missing night is skipped. */
  windowSpanNights: number;
  /** Robust z (median and MAD) for falling asleep or waking earlier or later than usual. */
  shiftZ: number;
  /** Robust z for shorter or longer sleep. */
  durationZ: number;
  /** Robust z for activity later in the evening. */
  activityZ: number;
  /** One night this much shorter, alone: a single short night, not a change. */
  singleShortZ: number;
  irregularNights: number;
  irregularMinNights: number;
  /** Night-to-night change in falling asleep this many times the usual, ... */
  irregularFactor: number;
  /** ... and at least this many minutes, is irregular. */
  irregularMinMinutes: number;
  /** A day of heart rate counts when the watch was worn this share of the day. */
  minActivityWornShare: number;
  /** Nights left out after a change of time zone. */
  timezoneSettleNights: number;
  /** Days before a documented episode start that count as the run-up. */
  preEpisodeDays: number;
  /** An episode without an end date is taken to last this long. */
  episodeDefaultDays: number;
  /** Stable days are this far from any episode. */
  stableMarginDays: number;
  /** The hypothesis: an episode start within this many days after the signal. */
  horizonDays: number;
}

/** Checks a rules object against the schema. Throws with every error, in Swedish. */
export function parseRules(source: unknown): Rules {
  const { $schema: _s, ...rest } = (source ?? {}) as Record<string, unknown>;
  const errors = validate(source, RULES_SCHEMA as SchemaNode);
  if (errors.length) throw new Error(`rules/rules.json följer inte schemat: ${errors.join('; ')}`);
  return rest as unknown as Rules;
}

export const RULES: Rules = parseRules(RULES_SOURCE);

/** The rules version saved with every assessment. */
export const RULES_VERSION = RULES.version;
