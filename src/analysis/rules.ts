// All thresholds for the traffic light in one place. The level is decided here,
// in code, never by a language model (principle 6).

export const RULES = {
  points: {
    earlySign: 1,
    seriousSign: 2,
    measured: 1,
    silence: 1,
    jump: 1,
    heavyDay: 1,
    /** Fell asleep after 02:00 with no entry the evening before. */
    lateSleepNoEntry: 1,
  },
  /**
   * Measured signs (sleep under the limit, stress over baseline, late sleep, words per
   * minute) give at most this many points together per day, so one bad night is not
   * counted several times.
   */
  measuredCapPerDay: 2,
  /** Words per minute more than this fraction above baseline is a sign. */
  speechFastFraction: 0.25,
  /** Daily stress average above baseline times this factor is a sign. */
  stressFactor: 1.3,
  /** Entries made from 00:00 up to (not including) this hour are a sign. */
  nightEntryEndHour: 5,
  /** Days without an entry before a day counts as silence. */
  silenceDays: 2,
  /** Jump in mood or energy against the 7-day average. */
  jumpThreshold: 2.5,
  jumpWindowDays: 7,
  jumpMinSamples: 3,
  /** Baselines are computed on green days within this window. */
  baselineWindowDays: 28,
  baselineMinSamples: 3,
  /** Sleep onset from this hour (Garmin) together with no entry the evening before is a sign. */
  lateSleepHour: 2,
  /** Onsets from this hour on are daytime sleep, not a late night. */
  lateSleepLatestHour: 12,
  level: {
    yellowAt: 1,
    redAt: 4,
    /** Red at this many points when enough recent days were yellow or red. */
    redWithHistoryAt: 2,
    historyWindowDays: 7,
    historyNonGreenDays: 3,
  },
} as const;
