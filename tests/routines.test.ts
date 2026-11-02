// Routines from the plan: which are logged, reminder times from the plan's own words,
// logging in the check-in without touching the level, and how often they were kept.

import fs from 'node:fs';
import path from 'node:path';
import { buildContext } from '../src/core/context/buildContext';
import { approveHeading, draftFromText } from '../src/core/plan/importPlan';
import { routineLog, routineSettings, routineStats, routineSummary, routines, suggestReminderTime, trackedRoutines } from '../src/core/plan/routines';
import { saveApprovedRows } from '../src/services/savePlan';
import { saveCheckin } from '../src/services/checkin';
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

describe('reminder times from the plan\'s own words', () => {
  it.each([
    ['Tar min medicin klockan 21', '21:00'],
    ['Medicin kl. 7.30 varje morgon', '07:30'],
    ['Sömn 22:30–07:00 alla dagar, även helger', '22:00'],
    ['Högst två koppar kaffe om dagen och inget efter 14', null],
    ['Rör på mig ute minst en gång om dagen', null],
  ])('%s → %s', (text, time) => {
    expect(suggestReminderTime(text)).toBe(time);
  });
});

describe('routines from the plan', () => {
  it('logs the routines that hold for both directions by default, and the person can change it', async () => {
    const repo = await examplePlan();
    const all = routines(repo.contextEntries());
    expect(all.length).toBeGreaterThanOrEqual(11);
    const tracked = trackedRoutines(repo.contextEntries()).map((e) => e.text);
    expect(tracked).toContain('Tar min medicin klockan 21');
    expect(tracked).not.toContain('Dämpar belysningen på kvällen'); // only at signs of mani
    const dim = all.find((e) => e.text === 'Dämpar belysningen på kvällen')!;
    expect(routineSettings(dim)).toEqual({ track: false, reminder: null });
    await repo.updateContextEntry(dim.id, { routine: { track: true, reminder: '21:30' } });
    expect(trackedRoutines(repo.contextEntries()).map((e) => e.text)).toContain('Dämpar belysningen på kvällen');
    expect(routineSettings(repo.findEntry(dim.id)!)).toEqual({ track: true, reminder: '21:30' });
  });

  it('saves the evening\'s answers without changing the level, and a new answer replaces the old', async () => {
    const repo = await examplePlan();
    const [med, food] = trackedRoutines(repo.contextEntries()).filter((e) => /medicin|frukost/.test(e.text));
    const now = new Date('2026-11-04T21:00:00');
    const input = { transcript: 'Vanlig dag.', mood: 0, energy: 5, wordsPerMinute: null };
    const plain = await saveCheckin(repo, input, now);
    const logged = await saveCheckin(repo, { ...input, routines: { [med.id]: true, [food.id]: false } }, now);
    expect([logged.assessment.level, logged.assessment.points]).toEqual([plain.assessment.level, plain.assessment.points]);
    expect(Object.fromEntries(routineLog(repo.contextEntries(), '2026-11-04'))).toEqual({ [med.id]: true, [food.id]: false });
    await saveCheckin(repo, { ...input, routines: { [med.id]: false, [food.id]: null } }, now);
    expect(Object.fromEntries(routineLog(repo.contextEntries(), '2026-11-04'))).toEqual({ [med.id]: false });
    expect(repo.contextOf('routine_done')).toHaveLength(1);
  });

  it('says what was done, in positive words, and counts the last 14 evenings', async () => {
    const repo = await examplePlan();
    const med = trackedRoutines(repo.contextEntries()).find((e) => /medicin/.test(e.text))!;
    const input = { transcript: 'Vanlig dag.', mood: 0, energy: 5, wordsPerMinute: null };
    for (const [day, done] of [['2026-11-01', true], ['2026-11-02', false], ['2026-11-03', true]] as const) {
      await saveCheckin(repo, { ...input, routines: { [med.id]: done } }, new Date(`${day}T21:00:00`));
    }
    expect(routineSummary(repo.contextEntries(), '2026-11-03', 6)).toEqual({ done: ['Tar min medicin klockan 21'], answered: 6 });
    expect(routineSummary(repo.contextEntries(), '2026-10-30')).toBeNull();
    const stat = routineStats(repo.contextEntries(), '2026-11-03').find((s) => s.routine.id === med.id)!;
    expect([stat.answered, stat.done]).toEqual([3, 2]);
    expect(routineStats(repo.contextEntries(), '2026-11-20').find((s) => s.routine.id === med.id)!.answered).toBe(0);
  });

  it('never sends routines or the evening\'s answers to a model', async () => {
    const repo = await examplePlan();
    const med = trackedRoutines(repo.contextEntries()).find((e) => /medicin/.test(e.text))!;
    await saveCheckin(repo, { transcript: 'Vanlig dag.', mood: 0, energy: 5, wordsPerMinute: null, routines: { [med.id]: true } }, new Date('2026-11-04T21:00:00'));
    const entry = repo.entries()[0];
    const sent = Object.values(buildContext({ entries: repo.contextEntries(), entry, history: [] }).variables).join('\n');
    expect(sent).not.toContain('Tar min medicin klockan 21');
  });
});
