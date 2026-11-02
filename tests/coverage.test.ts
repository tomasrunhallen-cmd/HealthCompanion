import { thinLine, thinReasons } from '../src/core/analysis/coverage';
import { computeBaseline, type HistoryDay } from '../src/core/analysis/scoring';
import type { Assessment, Entry } from '../src/core/domain/types';

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e', date: '2026-11-02', createdAt: '2026-11-02T20:00:00', localTime: '20:00', kind: 'checkin', transcript: 'Vanlig dag.',
  mood: 0, energy: 5, wordsPerMinute: null, sleepHours: 7.5, sleepSource: 'garmin', stressAvg: 30, ...over,
});
const assessment = (over: Partial<Assessment> = {}): Assessment => ({
  id: 'a', entryId: 'e', date: '2026-11-02', createdAt: '', level: 'green', points: 0, signals: [], sentence: '', method: 'wordmatch',
  model: null, promptId: null, promptVersion: null, baseline: { wordsPerMinute: null, stressAvg: 30, greenDays: 10 }, ...over,
});

describe('Underlaget är tunt', () => {
  it('says nothing for a full day', () => {
    expect(thinLine(entry(), assessment())).toBeNull();
  });

  it('names what is missing: sleep, the note, a lagging watch, the usual state', () => {
    const e = entry({ sleepHours: null, transcript: '', measuredUntil: '06:10' });
    expect(thinReasons(e, assessment({ baseline: { wordsPerMinute: null, stressAvg: null, greenDays: 0 } }))).toEqual([
      'ingen anteckning', 'sömn saknas', 'klockan hade bara synkat till 06:10', 'appen känner inte ditt vanliga läge än',
    ]);
  });

  it('says when the person kept a day the watch\'s later values would have changed', () => {
    expect(thinLine(entry(), assessment({ remeasureDeclined: { at: '', level: 'yellow', points: 1 } })))
      .toBe('Underlaget är tunt: med klockans senare värden hade dagen blivit gul.');
  });

  it('is never shown with the crisis card', () => {
    expect(thinReasons(entry({ sleepHours: null }), assessment({ akut: true, level: 'red' }))).toEqual([]);
  });
});

describe('Baslinjen tar bara fullständiga gröna dagar', () => {
  const day = (i: number, over: Partial<Entry>): HistoryDay => ({ entry: entry({ id: `d${i}`, date: `2026-10-${String(10 + i).padStart(2, '0')}`, ...over }), level: 'green' });
  it('leaves out green days without sleep and days after alcohol, illness or hard training', () => {
    const history = [day(1, {}), day(2, {}), day(3, { sleepHours: null }), day(4, { strainYesterday: true, stressAvg: 80 }), day(5, {})];
    const b = computeBaseline('2026-11-02', history);
    expect(b.greenDays).toBe(3);
    expect(b.stressAvg).toBe(30);
  });
});
