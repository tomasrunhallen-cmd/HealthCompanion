// Lågt läge keeps the level and the plan's first step after a yellow or red evening.
import { LOW_MODE_DAYS, lowModeSupport } from '../src/core/analysis/lowMode';
import type { Assessment, PlanItem } from '../src/core/domain/types';

const plan: PlanItem[] = [
  { id: 'y1', kind: 'action_yellow', text: 'Gå och lägg dig före 23', order: 0, approvedAt: '' },
  { id: 'r1', kind: 'action_red', text: 'Ring mottagningen samma dag', order: 0, approvedAt: '' },
];
const a = (date: string, level: Assessment['level']): Assessment => ({ id: `a_${date}`, entryId: `e_${date}`, date, createdAt: `${date}T21:00:00`, level, points: 0, signals: [] } as unknown as Assessment);

describe('Lågt läge', () => {
  it('shows the latest yellow or red evening with the first step of the plan', () => {
    expect(lowModeSupport([a('2026-11-20', 'green'), a('2026-11-21', 'yellow')], plan, '2026-11-22')).toEqual({ level: 'yellow', date: '2026-11-21', step: 'Gå och lägg dig före 23', serious: false });
    expect(lowModeSupport([a('2026-11-22', 'red')], plan, '2026-11-22')?.step).toBe('Ring mottagningen samma dag');
  });

  it('shows nothing after a green evening or an old one', () => {
    expect(lowModeSupport([a('2026-11-21', 'yellow'), a('2026-11-22', 'green')], plan, '2026-11-22')).toBeNull();
    expect(lowModeSupport([a('2026-11-10', 'red')], plan, '2026-11-22')).toBeNull();
    expect(LOW_MODE_DAYS).toBe(3);
  });

  it('says so when the plan has no step for the level', () => {
    expect(lowModeSupport([a('2026-11-22', 'red')], [], '2026-11-22')).toEqual({ level: 'red', date: '2026-11-22', step: null, serious: false });
  });
});

describe('the same step as the result view', () => {
  it('a yellow day with a serious sign gives the plan\'s red step in both', () => {
    const { priorityStep, seriousActions } = require('../src/core/analysis/assess') as typeof import('../src/core/analysis/assess');
    const day = { ...a('2026-11-22', 'yellow'), signals: [{ kind: 'serious_sign', points: 2, label: 'Slutar äta', measured: false }] } as unknown as Assessment;
    const low = lowModeSupport([day], plan, '2026-11-22');
    expect(low).toEqual({ level: 'yellow', date: '2026-11-22', step: 'Ring mottagningen samma dag', serious: true });
    // The result view shows the red steps first on this day; the first of them is the same step.
    expect(seriousActions(day, plan)?.[0].text).toBe(low!.step);
    expect(priorityStep(day, plan)?.step?.text).toBe(low!.step);
  });
});
