import { explainAssessment } from '../src/core/analysis/explain';
import { levelFromSignals } from '../src/core/analysis/scoring';
import type { Assessment, Entry, Signal } from '../src/core/domain/types';

const entry: Entry = {
  id: 'e1', date: '2026-10-31', createdAt: new Date(2026, 9, 31, 22, 5).toISOString(), kind: 'checkin',
  transcript: 'Lugn kväll, men jag är trött.', mood: 0, energy: 6, wordsPerMinute: null,
  sleepHours: 4.5, sleepSource: 'garmin', stressAvg: 47,
};

function sig(kind: Signal['kind'], points: number, label: string, measured = true): Signal {
  return { kind, points, label, measured };
}

function assessment(over: Partial<Assessment>): Assessment {
  return {
    id: 'a1', entryId: 'e1', date: '2026-10-31', createdAt: '', level: 'green', points: 0, signals: [],
    sentence: '', method: 'llm', model: 'mistral-small-latest', promptId: 'analys', promptVersion: '1.1.0',
    baseline: { wordsPerMinute: null, stressAvg: 31, greenDays: 5 }, ...over,
  };
}

describe('explaining an assessment', () => {
  it('lists the data, the signs and why the level is yellow', () => {
    const signals = [sig('sleep_low', 1, 'Sömn 4,5 h, under din gräns på 5 h'), sig('late_sleep_no_entry', 2, 'Somnade 02:40 enligt klockan, utan inlägg kvällen innan')];
    const { level, reason } = levelFromSignals(signals, 0);
    const why = explainAssessment(entry, assessment({ level, points: 3, signals, levelReason: reason }), {
      date: '2026-10-31', sleepHours: 4.5, deepMinutes: 70, remMinutes: 90, sleepStart: '02:40', sleepEnd: '07:10',
      stressAvg: 47, stressHighMinutes: 45, bodyBatteryWake: 41, fetchedAt: '',
    });
    expect(why.data).toEqual([
      'Din anteckning, 6 ord',
      'Stämning balanserad (0) och energi 6, mot snittet för sju dagar',
      'Sömn 4,5 h från Garmin, somnade 02:40',
      'Stress 47 i dag, ditt vanliga 31',
      'Body Battery 41 vid uppvaknandet',
      'Inlägget gjordes 22:05',
      'Tecknen tolkades av mistral-small-latest, med dagens och veckans mätvärden som bakgrund',
    ]);
    expect(why.signs).toEqual([
      { label: 'Sömn 4,5 h, under din gräns på 5 h', points: 1 },
      { label: 'Somnade 02:40 enligt klockan, utan inlägg kvällen innan', points: 2 },
    ]);
    expect(why.conclusion).toBe('3 poäng ger gult. Gult börjar vid 1 poäng och rött vid 4.');
  });

  it('names the rule behind a red level', () => {
    const three = [sig('sleep_low', 1, 'a'), sig('speech_fast', 1, 'b'), sig('night_entry', 1, 'c')];
    expect(levelFromSignals(three, 0)).toMatchObject({ level: 'yellow', reason: 'points' });
    expect(explainAssessment(entry, assessment({ level: 'red', points: 3, signals: three, levelReason: 'measured_three' }), null).conclusion)
      .toBe('Tre mätta tecken samma dag gav rött enligt en regel som numera är borttagen.');
    const firstDay = [sig('sleep_low', 1, 'a'), sig('stress_high', 1, 'b'), sig('early_sign', 1, 'c', false), sig('night_entry', 1, 'd')];
    expect(levelFromSignals(firstDay, 0)).toMatchObject({ level: 'yellow', reason: 'measured_first_day' });
    expect(explainAssessment(entry, assessment({ level: 'yellow', points: 4, signals: firstDay, levelReason: 'measured_first_day' }), null).conclusion)
      .toContain('räknas bara mot rött när de fanns även dagen innan');
    const serious = [sig('serious_sign', 2, 'Slutar äta', false), sig('silence', 1, 'tyst')];
    expect(levelFromSignals(serious, 0).reason).toBe('serious_plus_other');
    const two = [sig('early_sign', 1, 'x', false), sig('silence', 1, 'y')];
    expect(levelFromSignals(two, 3)).toMatchObject({ level: 'red', reason: 'recent_days' });
    expect(explainAssessment(entry, assessment({ level: 'red', points: 2, signals: two, levelReason: 'recent_days', recentNonGreenDays: 3 }), null).conclusion)
      .toBe('2 poäng ger rött när minst 3 av de senaste 7 dagarna varit gula eller röda. Det var 3.');
  });

  it('works for older assessments without a stored reason, and for green days', () => {
    const red = explainAssessment(entry, assessment({ level: 'red', points: 4, signals: [sig('early_sign', 4, 'x', false)] }), null);
    expect(red.conclusion).toBe('4 poäng ger rött. Rött börjar vid 4 poäng.');
    const green = explainAssessment({ ...entry, sleepHours: 6, sleepSource: 'transcript', stressAvg: null }, assessment({ method: 'wordmatch', baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 1 } }), null);
    expect(green.conclusion).toBe('Inga tecken och inga avvikande mätvärden, 0 poäng. Det ger grönt.');
    expect(green.data).toContain('Sömn 6 h, skattat ur anteckningen');
    expect(green.data).toContain('Tecknen hittades med ordmatchning på telefonen');
    expect(green.data).toContain('Baslinjen är inte klar: 1 av 3 gröna dagar');
    expect(green.signs).toEqual([]);
  });
});
