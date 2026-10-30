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
  },
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
  /** Sleep onset after this hour together with no entry gives two signs (step 3, Garmin). */
  lateSleepHour: 2,
  level: {
    yellowAt: 1,
    redAt: 4,
    /** Red at this many points when enough recent days were yellow or red. */
    redWithHistoryAt: 2,
    historyWindowDays: 7,
    historyNonGreenDays: 3,
    /**
     * ASSUMPTION, flagged in README: red when this many measured signs occur on the same day.
     * The spec's test case "4 h sleep, 180 wpm, entry at 01:15 gives red" only adds up to
     * 3 points under the other rules, so the spec cannot be met without an extra rule.
     */
    redMeasuredSigns: 3,
  },
} as const;
