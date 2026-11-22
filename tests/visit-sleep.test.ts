// Inför återbesök: sleep with how many nights it rests on, and how it went in each half.
import { sleepStressText, type VisitSummary } from '../src/core/analysis/visit';

const day = (i: number, sleep: number | null, stress: number | null = null) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, level: null, mood: null, sleepHours: sleep, stressAvg: stress, direction: null, notes: [] });

describe('sleep in the visit summary', () => {
  it('names the nights with data apart from the check-ins, and the change between the halves', () => {
    const days = [day(0, 7.5), day(1, 7.4), day(2, null), day(3, 6.0), day(4, 5.8), day(5, null)];
    const s = { days, sleepAvg: 6.7, stressAvg: 30, sleepNights: 4, stressDays: 2, sleepHalves: { first: 7.5, second: 5.9 } } as Pick<VisitSummary, 'days' | 'sleepAvg' | 'stressAvg' | 'sleepNights' | 'stressDays' | 'sleepHalves'>;
    expect(sleepStressText(s)).toBe('Sömn finns för 4 av 6 nätter, snitt 6,7 h. Första halvan 7,5 h, andra halvan 5,9 h. Stress finns för 2 av 6 dagar, snitt 30.');
  });

  it('says so when nothing was registered', () => {
    const s = { days: [day(0, null)], sleepAvg: null, stressAvg: null, sleepNights: 0, stressDays: 0, sleepHalves: { first: null, second: null } };
    expect(sleepStressText(s)).toBe('Ingen sömn eller stress registrerad under dagen.');
  });
});
