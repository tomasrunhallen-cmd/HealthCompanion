// Sleep phases from the watch: parsing, the shares shown, and less deep sleep in Mina mönster.
import { addDays } from '../src/core/analysis/dates';
import { lessDeep } from '../src/core/analysis/moodPatterns';
import { meanPhases, phasesOf, phasesText } from '../src/core/analysis/sleepPhases';
import { formatMeasurements } from '../src/core/analysis/measurements';
import type { MeasuredDay } from '../src/core/domain/types';
import { parseSleep } from '../src/garmin/client';

const day = (date: string, deep: number | null, light: number | null, rem: number | null, awake: number | null = 10): MeasuredDay => ({
  date, sleepHours: 7, deepMinutes: deep, remMinutes: rem, lightMinutes: light, awakeMinutes: awake, sleepStart: '23:00', sleepEnd: '06:10',
  stressAvg: null, stressHighMinutes: null, bodyBatteryWake: null, fetchedAt: '2026-11-25T08:00:00.000Z', source: 'garmin',
});

describe('the phases from Garmin', () => {
  it('reads deep, light, REM and awake time from the sleep summary', () => {
    const [r] = parseSleep([{ dailySleepDTO: { calendarDate: '2026-11-25', sleepTimeSeconds: 25200, deepSleepSeconds: 4800, lightSleepSeconds: 14400, remSleepSeconds: 6000, awakeSleepSeconds: 900 } }]);
    expect(r).toMatchObject({ deepMinutes: 80, lightMinutes: 240, remMinutes: 100, awakeMinutes: 15 });
  });

  it('gives the shares of the night in words, and nothing for a day without light sleep', () => {
    const p = phasesOf(day('2026-11-25', 80, 240, 100, 20))!;
    expect(p.map((x) => x.minutes)).toEqual([80, 240, 100, 20]);
    expect(phasesText(p)).toBe('djup 1 h 20 min (18 %), lätt 4 h (55 %), rem 1 h 40 min (23 %), vaken 20 min (5 %)');
    expect(phasesOf(day('2026-11-24', 80, null, 100))).toBeNull();
  });

  it('averages only the nights that have phases', () => {
    const days = { a: day('2026-11-20', 60, 200, 90), b: day('2026-11-21', 100, 240, 110), c: day('2026-11-22', 70, null, 90) };
    const m = meanPhases({ '2026-11-20': days.a, '2026-11-21': days.b, '2026-11-22': days.c }, '2026-11-20', '2026-11-22')!;
    expect(m.nights).toBe(2);
    expect(m.parts.find((x) => x.phase === 'deep')!.minutes).toBe(80);
  });

  it('sends the phases to the model for the day itself, as background', () => {
    const text = formatMeasurements([{ date: '2026-11-25', sleepHours: 7, sleepSource: 'garmin', sleepStart: '23:00', sleepEnd: '06:10', deepMinutes: 80, remMinutes: 100, lightMinutes: 240, awakeMinutes: 15, stressAvg: null, stressSource: null, stressHighMinutes: null, bodyBatteryWake: null }]);
    expect(text).toContain('lätt sömn 240 min');
    expect(text).toContain('vaken 15 min');
  });
});

describe('less deep sleep, for Mina mönster', () => {
  const today = '2026-11-25';
  const series = (usual: number[], latest: number[]) => {
    const m = new Map<string, number>();
    usual.forEach((v, i) => m.set(addDays(today, -(4 + i)), v));
    latest.forEach((v, i) => m.set(addDays(today, -(latest.length - 1 - i)), v));
    return m;
  };
  const usual = Array.from({ length: 30 }, (_, i) => 80 + (i % 5) * 4);

  it('is found when the latest three nights all lie clearly below the usual', () => {
    expect(lessDeep(series(usual, [45, 50, 40]), today)).toEqual({ judged: true, found: true });
  });

  it('is not found for one low night, nor for nights within the usual spread', () => {
    expect(lessDeep(series(usual, [85, 40, 84]), today).found).toBe(false);
    expect(lessDeep(series(usual, [78, 80, 76]), today).found).toBe(false);
  });

  it('cannot be judged with too few earlier nights', () => {
    expect(lessDeep(series(usual.slice(0, 10), [45, 50, 40]), today)).toEqual({ judged: false, found: false });
  });
});
