// B4: the day runs 04:00–04:00 in local time. Daylight saving time, travel across time zones
// and entries after midnight. `npm test` runs this file twice, with the phone in Stockholm and
// in New York (TZ=...), because a time zone cannot be changed inside one Jest run.

import { entryClock, eveningDateKey, localClock } from '../../src/core/analysis/dates';
import { score } from '../../src/core/analysis/scoring';
import type { Entry } from '../../src/core/domain/types';

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const entry = (createdAt: string, localTime?: string): Entry => ({
  id: 'e', date: '2026-11-04', createdAt, localTime: localTime ?? null, kind: 'checkin', transcript: '',
  mood: 0, energy: 5, wordsPerMinute: null, sleepHours: 7.5, sleepSource: null, stressAvg: null,
});
const nightSign = (e: Entry) =>
  score({ entry: e, matches: [], plan: [], planSettings: { normalState: '', sleepThresholdHours: 5 }, history: [] }).signals.some((s) => s.kind === 'night_entry');
/** 22:00 in New York is 04:00 the next morning in Stockholm. */
const TRAVEL = new Date('2026-11-05T03:00:00Z');

it('runs in one of the two zones', () => {
  expect(['Europe/Stockholm', 'America/New_York']).toContain(zone);
});

it('puts an entry after midnight on the day before, and 04:00 on the new day', () => {
  expect(eveningDateKey(new Date(2026, 10, 5, 0, 30))).toBe('2026-11-04');
  expect(eveningDateKey(new Date(2026, 10, 5, 3, 59))).toBe('2026-11-04');
  expect(eveningDateKey(new Date(2026, 10, 5, 4, 0))).toBe('2026-11-05');
  expect(nightSign(entry(new Date(2026, 10, 5, 1, 15).toISOString(), '01:15'))).toBe(true);
});

(zone === 'Europe/Stockholm' ? describe : describe.skip)('in Stockholm', () => {
  it('follows the clock across daylight saving time in spring', () => {
    // 29 March 2026: 02:00 becomes 03:00. 03:30 local is 01:30 UTC.
    expect([eveningDateKey(new Date('2026-03-29T01:30:00Z')), localClock(new Date('2026-03-29T01:30:00Z'))]).toEqual(['2026-03-28', '03:30']);
    expect([eveningDateKey(new Date('2026-03-29T02:00:00Z')), localClock(new Date('2026-03-29T02:00:00Z'))]).toEqual(['2026-03-29', '04:00']);
  });

  it('and in autumn, where 02:30 happens twice and both belong to the day before', () => {
    expect(eveningDateKey(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-24'); // 02:30 summer time
    expect(eveningDateKey(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-24'); // 02:30 winter time
    expect(eveningDateKey(new Date('2026-10-25T03:00:00Z'))).toBe('2026-10-25'); // 04:00
  });

  it('after a trip home, an evening entry made in New York stays an evening entry', () => {
    expect([eveningDateKey(TRAVEL), localClock(TRAVEL)]).toEqual(['2026-11-05', '04:00']);
    expect(entryClock(entry(TRAVEL.toISOString(), '22:00'))).toEqual({ hour: 22, minute: 0 });
    expect(nightSign(entry(TRAVEL.toISOString(), '22:00'))).toBe(false);
    // An entry saved before the local time existed is read in the phone's current zone: 04:00,
    // which since rules 1.2.0 is the start of a new day, not a night entry.
    expect(entryClock(entry(TRAVEL.toISOString()))).toEqual({ hour: 4, minute: 0 });
    expect(nightSign(entry(TRAVEL.toISOString()))).toBe(false);
  });
});

(zone === 'America/New_York' ? describe : describe.skip)('in New York', () => {
  it('dates an entry by the clock where it is made', () => {
    expect([eveningDateKey(TRAVEL), localClock(TRAVEL)]).toEqual(['2026-11-04', '22:00']);
  });

  it('follows the clock when daylight saving time ends, a week later than in Europe', () => {
    // 1 November 2026: 02:00 becomes 01:00 in New York.
    expect(eveningDateKey(new Date('2026-11-01T05:30:00Z'))).toBe('2026-10-31'); // 01:30 EDT
    expect(eveningDateKey(new Date('2026-11-01T06:30:00Z'))).toBe('2026-10-31'); // 01:30 EST
    expect(eveningDateKey(new Date('2026-11-01T09:00:00Z'))).toBe('2026-11-01'); // 04:00 EST
  });
});
