import { HOME_PRIORITY, homeQueue, laterToday, putAside, type HomeCard } from '../src/core/analysis/homeCards';

const all: HomeCard[] = [
  { kind: 'routines', id: 'routines' },
  { kind: 'suggestions', id: 'suggestions' },
  { kind: 'tomorrow', id: 'tomorrow_2026-11-02_Fest' },
  { kind: 'tomorrow', id: 'tomorrow_2026-11-02_Resa' },
  { kind: 'weekPicture', id: 'weekPicture' },
  { kind: 'silence', id: 'silence_3' },
];

describe('Startsidan: ett kort åt gången', () => {
  it('ranks safety first, the day\'s routines right after what concerns days already saved, and app reminders last', () => {
    expect(HOME_PRIORITY[0]).toBe('silence');
    expect(HOME_PRIORITY[HOME_PRIORITY.length - 1]).toBe('standardNudge');
    expect(HOME_PRIORITY.indexOf('routines')).toBe(HOME_PRIORITY.indexOf('reread') + 1);
    expect(homeQueue(all, []).map((c) => c.kind)).toEqual(['silence', 'tomorrow', 'tomorrow', 'routines', 'weekPicture', 'suggestions']);
  });

  it('shows the next card when one is put aside, and only that one', () => {
    const later = putAside(null, '2026-11-01', 'tomorrow_2026-11-02_Fest');
    const q = homeQueue(all, laterToday(later, '2026-11-01'));
    expect(q.map((c) => c.id)).toEqual(['silence_3', 'tomorrow_2026-11-02_Resa', 'routines', 'weekPicture', 'suggestions']);
  });

  it('brings the cards back the next day', () => {
    const later = putAside(putAside(null, '2026-11-01', 'silence_3'), '2026-11-01', 'silence_3');
    expect(later.ids).toEqual(['silence_3']);
    expect(laterToday(later, '2026-11-02')).toEqual([]);
    expect(homeQueue(all, laterToday(later, '2026-11-02'))[0].id).toBe('silence_3');
  });

  it('starts a new list on a new day', () => {
    const later = putAside({ date: '2026-10-31', ids: ['suggestions'] }, '2026-11-01', 'routines');
    expect(later).toEqual({ date: '2026-11-01', ids: ['routines'] });
  });

  it('shows nothing when there is nothing', () => {
    expect(homeQueue([], [])).toEqual([]);
  });
});
