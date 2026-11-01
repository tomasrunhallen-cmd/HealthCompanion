// How the plan's fields are used (A5): the direction of the day's signs in the plan's own
// words, actions and routines for that direction, value anchors, the ladder in Hjälp nu.
// Points and level never change, and wishes and notes for the care never reach a model.

import fs from 'node:fs';
import path from 'node:path';
import { assessEntry, firstStep, wordMatcher } from '../src/analysis/assess';
import { buildContext } from '../src/context/buildContext';
import { crisisInfo } from '../src/context/akut';
import type { Entry, PlanItem, Signal } from '../src/domain/types';
import { approveHeading, draftFromText } from '../src/plan/importPlan';
import { actionsFor, directionSentence, ladderOf, routinesFor, showValueAnchors, signDirection } from '../src/plan/guidance';
import { saveApprovedRows } from '../src/plan/savePlan';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

const markdown = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'krisplan-exempel.md'), 'utf8');

async function examplePlan(): Promise<Repository> {
  const repo = await Repository.create(memoryBackend());
  let d = draftFromText(markdown);
  for (const h of new Set(d.rows.map((r) => r.heading))) d = approveHeading(d, h);
  await saveApprovedRows(repo, d);
  return repo;
}

const day = (transcript: string): Entry => ({
  id: 'e1', date: '2026-11-04', createdAt: '2026-11-04T21:00:00', kind: 'checkin', transcript,
  mood: 5, energy: 5, wordsPerMinute: null, sleepHours: 7.5, sleepSource: null, stressAvg: null,
});

const sig = (item: PlanItem): Signal => ({ kind: item.kind === 'serious' ? 'serious_sign' : 'early_sign', points: 1, label: item.text, planItemId: item.id, measured: false });

describe('the direction of the day\'s signs', () => {
  it('says which way the signs point, in the plan\'s own words, and both when mixed', async () => {
    const repo = await examplePlan();
    const plan = repo.plan();
    const up = plan.find((p) => p.text === 'Pratar fortare och avbryter ofta')!;
    const down = plan.find((p) => p.text === 'Orkar inte laga mat')!;
    expect(signDirection([sig(up)], plan)).toBe('up');
    expect(signDirection([sig(down)], plan)).toBe('down');
    expect(signDirection([sig(up), sig(down)], plan)).toBe('both');
    expect(signDirection([], plan)).toBeNull();
    const ps = repo.planSettings();
    expect(directionSentence('up', ps)).toBe('Tecknen i dag pekar åt ”mani”. Åtgärderna nedan är de som gäller det, och de som gäller båda hållen.');
    expect(directionSentence('both', ps)).toContain('”mani” och ”depression”');
    // No diagnosis words when the plan has none of its own.
    expect(directionSentence('down', { polarityWords: null })).toContain('”nedstämd”');
  });

  it('never changes points or level', async () => {
    const repo = await examplePlan();
    const withFields = repo.plan();
    const without = withFields.map(({ plan: _plan, ...p }) => p);
    const ps = { normalState: '', sleepThresholdHours: 5 };
    const note = 'Pratar fortare och avbryter ofta. Orkar inte laga mat.';
    const a = await assessEntry({ entry: day(note), plan: withFields, planSettings: ps, history: [], matcher: wordMatcher });
    const b = await assessEntry({ entry: day(note), plan: without, planSettings: ps, history: [], matcher: wordMatcher });
    expect([a.level, a.points]).toEqual([b.level, b.points]);
    expect(a.signals.map((s) => s.planItemId)).toEqual(b.signals.map((s) => s.planItemId));
  });
});

describe('actions and routines for the direction', () => {
  it('shows the actions for that direction and for both; never the care\'s actions or the ladder as the person\'s steps', async () => {
    const repo = await examplePlan();
    const plan = repo.plan();
    // Rows the plan does not mark with a direction are "both" and always shown.
    const all = actionsFor('yellow', plan).map((p) => p.text);
    expect(all).toEqual([
      'Går och lägger mig före 23 varje kväll', 'Stänger av telefonen klockan 21', 'Skjuter upp stora köp i minst en vecka',
      'Går ut i dagsljus minst en halvtimme om dagen', 'Berättar för min kontaktperson hur jag mår',
    ]);
    const red = actionsFor('red', plan).map((p) => p.text);
    expect(red).not.toContain('Erbjuder en tid samma dag eller dagen efter');
    expect(red.some((t) => t.startsWith('Om jag inte lyssnar'))).toBe(false);
    expect(firstStep('red', plan)?.text).toBe('Ringer mottagningen samma dag');

    const marked = plan.map((p) => (p.text === 'Skjuter upp stora köp i minst en vecka' ? { ...p, plan: { ...p.plan!, polarity: 'up' as const } } : p));
    expect(actionsFor('yellow', marked, 'down').map((p) => p.text)).not.toContain('Skjuter upp stora köp i minst en vecka');
    expect(actionsFor('yellow', marked, 'up').map((p) => p.text)).toContain('Skjuter upp stora köp i minst en vecka');
    expect(actionsFor('yellow', marked, 'both')).toHaveLength(5);
  });

  it('shows the routines with the yellow actions, by direction', async () => {
    const repo = await examplePlan();
    const routines = repo.contextOf('routine');
    const up = routinesFor(routines, 'up').map((e) => e.text);
    expect(up).toContain('Dämpar belysningen på kvällen');
    expect(up).not.toContain('Planerar en sak att se fram emot varje dag');
    expect(up).toContain('Sömn 22:30–07:00 alla dagar, även helger');
    expect(routinesFor(routines, null)).toHaveLength(routines.length);
  });
});

describe('value anchors', () => {
  it('are shown on red and after three yellow days in a row', () => {
    const y = (date: string) => ({ date, level: 'yellow' as const });
    expect(showValueAnchors({ level: 'red', date: '2026-11-04' }, [])).toBe(true);
    expect(showValueAnchors({ level: 'yellow', date: '2026-11-04' }, [y('2026-11-02'), y('2026-11-03')])).toBe(true);
    expect(showValueAnchors({ level: 'yellow', date: '2026-11-04' }, [y('2026-11-01'), y('2026-11-03')])).toBe(false);
    expect(showValueAnchors({ level: 'green', date: '2026-11-04' }, [y('2026-11-02'), y('2026-11-03')])).toBe(false);
  });
});

describe('the ladder in Hjälp nu', () => {
  it('shows the plan\'s steps, numbered, under the plan\'s own heading', async () => {
    const repo = await examplePlan();
    const info = crisisInfo(repo.plan());
    expect(info.ladder?.heading).toBe('Strategier för att undvika tvångsåtgärder');
    expect(info.ladder?.steps).toHaveLength(4);
    expect(info.ladder?.steps[0]).toMatch(/^Om jag inte lyssnar på mina närstående/);
    expect(ladderOf(repo.plan())?.steps.map((p) => p.plan?.order)).toEqual([1, 2, 3, 4]);
    expect(info.steps[0]).toBe('Ringer mottagningen samma dag');
  });
});

describe('what never reaches a model', () => {
  it('leaves wishes, notes for the care, contacts and value anchors out of the context sent with a note', async () => {
    const repo = await examplePlan();
    const built = buildContext({ entries: repo.contextEntries(), entry: day('Vanlig dag'), history: [] }, repo.planSettings());
    const sent = Object.values(built.variables).join('\n');
    for (const kind of ['wish', 'note_for_care', 'contact', 'value_anchor', 'akut'] as const) {
      for (const e of repo.contextOf(kind)) expect(sent).not.toContain(e.text);
    }
    expect(repo.contextOf('wish')).toHaveLength(4);
  });
});
