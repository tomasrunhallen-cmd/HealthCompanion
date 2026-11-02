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
  /** Sleep below this is a sign until the person sets an own limit. */
  sleepThresholdHoursDefault: number;
  stressFactor: number;
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
