// C8 Kommande händelser: the weekly question, and the day before an event the plan's routines
// that fit it, in the plan's own words.

import { adviceForTomorrow, askAboutEvents } from '../src/core/analysis/events';
import { savePlanBlocks, planBlocks } from '../src/services/planBlocks';
import { addEvent, eventsAskedAt, markEventsAsked } from '../src/services/events';
import { repoWithPlan } from './helpers/plan';

describe('Kommande händelser', () => {
  it('asks once a week', async () => {
    const repo = await repoWithPlan();
    expect(askAboutEvents(eventsAskedAt(repo), '2026-11-04')).toBe(true);
    await markEventsAsked(repo, '2026-11-04');
    expect(askAboutEvents(eventsAskedAt(repo), '2026-11-10')).toBe(false);
    expect(askAboutEvents(eventsAskedAt(repo), '2026-11-11')).toBe(true);
  });

  it('the day before, shows the routines for the direction of a risk situation the event sounds like', async () => {
    const repo = await repoWithPlan();
    await savePlanBlocks(repo, planBlocks(repo).map((b) =>
      b.type === 'trigger' ? { ...b, text: 'Långa resor över flera tidszoner' }
        : b.type === 'routine_up' ? { ...b, text: 'Drick ingen alkohol\nHåll hårt i sömnen' } : b,
    ));
    await repo.updateContextEntry(repo.contextOf('trigger')[0].id, { plan: { kind: 'trigger', polarity: 'up' } });
    await addEvent(repo, 'Resa till Berlin', '2026-11-05');
    await addEvent(repo, 'Middag hos mamma', '2026-11-08');
    expect(adviceForTomorrow(repo.contextEntries(), '2026-11-04')).toEqual([
      { event: 'Resa till Berlin', date: '2026-11-05', trigger: 'Långa resor över flera tidszoner', routines: ['Drick ingen alkohol', 'Håll hårt i sömnen'] },
    ]);
    expect(adviceForTomorrow(repo.contextEntries(), '2026-11-07')).toEqual([
      { event: 'Middag hos mamma', date: '2026-11-08', trigger: null, routines: ['Sömn 22:30–07:00'] },
    ]);
    expect(adviceForTomorrow(repo.contextEntries(), '2026-11-05')).toEqual([]);
  });
});
