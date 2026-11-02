import { assessEntry } from '../src/core/analysis/assess';
import { explainAssessment } from '../src/core/analysis/explain';
import { buildContext } from '../src/core/context/buildContext';
import { loadStandard, parseStandard, standardNudgeWeek } from '../src/core/context/standard';
import { confirmStandard, replaceStandard, startWithStandard, unconfirmedStandard } from '../src/services/standard';
import type { Entry } from '../src/core/domain/types';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import { wordMatcher } from '../src/core/analysis/assess';

const NOW = new Date(2026, 10, 1, 21, 0);

function entry(transcript: string, over: Partial<Entry> = {}): Entry {
  return {
    id: 'e', date: '2026-11-01', createdAt: NOW.toISOString(), kind: 'checkin', transcript, mood: 0, energy: 5,
    wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null, ...over,
  };
}

// Every standard sign in one note.
const ALL_STANDARD_SIGNS =
  'Jag sover mindre. Många nya idéer. Jag pratar fortare än vanligt. Drar mig undan. Orkar inte gå upp. Sover på dagarna.';

describe('standard content', () => {
  it('reads early signs, actions and tone from context/standard.md, with no diagnosis words', () => {
    const { version, rows } = loadStandard();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(rows.filter((r) => r.kind === 'early').length).toBeGreaterThanOrEqual(4);
    expect(rows.some((r) => r.kind === 'action_yellow')).toBe(true);
    expect(rows.some((r) => r.kind === 'tone_yellow')).toBe(true);
    expect(rows.some((r) => r.kind === 'serious')).toBe(false);
    expect(rows.map((r) => r.text).join(' ').toLowerCase()).not.toMatch(/mani|depression|episod|bipolär/);
    expect(parseStandard('---\nid: s\nversion: 1.0.0\n---\n## Okänd rubrik\n- ignoreras\n## Tidiga tecken\n- Sover mindre').rows)
      .toEqual([{ kind: 'early', text: 'Sover mindre' }]);
  });

  it('buildContext without own data has only standard entries, and they can never give red', async () => {
    const repo = await Repository.create(memoryBackend());
    await startWithStandard(repo, NOW);
    expect(repo.settings().contextMode).toBe('standard');
    const bank = repo.contextEntries();
    expect(bank.length).toBeGreaterThan(0);
    expect(bank.every((e) => e.origin === 'standard' && e.approvedAt == null)).toBe(true);

    const e = entry(ALL_STANDARD_SIGNS);
    const ctx = buildContext({ entries: bank, entry: e, history: [] });
    expect(ctx.used.length).toBeGreaterThan(0);
    expect(ctx.used.every((id) => bank.find((b) => b.id === id)?.origin === 'standard')).toBe(true);
    expect(ctx.signs.every((s) => s.origin === 'standard')).toBe(true);

    const a = await assessEntry({ entry: e, plan: repo.plan(), planSettings: repo.planSettings(), history: [], matcher: wordMatcher, context: bank, now: NOW });
    expect(a.signals.filter((s) => s.kind === 'early_sign')).toHaveLength(6);
    expect(a.points).toBe(6);
    expect(a.level).toBe('yellow');
    expect(a.levelReason).toBe('standard_cap');
    expect(explainAssessment(e, a, null).conclusion).toContain('standardtecken som du inte bekräftat');
  });

  it('standard rows never decide red, and confirmed rows count fully', async () => {
    const repo = await Repository.create(memoryBackend());
    await startWithStandard(repo, NOW);
    // Short sleep two nights running and an entry at 01:15: three measured signs, no standard rows.
    const night = entry('Kunde inte somna.', { createdAt: new Date(2026, 10, 2, 1, 15).toISOString(), sleepHours: 4, sleepSource: 'garmin' });
    const yesterday = { entry: entry('Vanlig dag.', { id: 'y', date: '2026-10-31', sleepHours: 4, sleepSource: 'garmin' as const }), level: 'yellow' as const };
    const measured = await assessEntry({ entry: night, plan: repo.plan(), planSettings: repo.planSettings(), history: [yesterday], matcher: wordMatcher, context: repo.contextEntries(), now: NOW });
    expect(measured.signals.map((s) => s.kind).sort()).toEqual(['night_entry', 'sleep_low', 'sleep_low_consecutive']);
    expect(measured.signals.every((s) => !s.unconfirmedStandard)).toBe(true);
    expect(measured).toMatchObject({ level: 'yellow', points: 3 });

    for (const row of unconfirmedStandard(repo)) await confirmStandard(repo, row.id, NOW);
    const a = await assessEntry({ entry: entry(ALL_STANDARD_SIGNS), plan: repo.plan(), planSettings: repo.planSettings(), history: [], matcher: wordMatcher, context: repo.contextEntries(), now: NOW });
    expect(a.level).toBe('red');
    expect(a.levelReason).toBe('points_red');
  });

  it('the user\'s own plan replaces the unconfirmed standard rows', async () => {
    const repo = await Repository.create(memoryBackend());
    await startWithStandard(repo, NOW);
    const keep = unconfirmedStandard(repo)[0];
    await confirmStandard(repo, keep.id, NOW);
    const removed = await replaceStandard(repo);
    expect(removed).toBe(loadStandard().rows.length - 1);
    expect(repo.contextEntries().map((e) => e.id)).toEqual([keep.id]);
    expect(repo.settings().contextMode).toBe('own');
  });

  it('starting with standard twice does not add the rows twice', async () => {
    const repo = await Repository.create(memoryBackend());
    await startWithStandard(repo, NOW);
    await startWithStandard(repo, NOW);
    expect(repo.contextEntries()).toHaveLength(loadStandard().rows.length);
  });
});

describe('weekly reminder to replace standard', () => {
  const since = new Date(2026, 10, 1, 12).toISOString();
  const base = { contextMode: 'standard' as const, standardSince: since, standardNudgeDismissedWeek: null };
  const day = (n: number) => new Date(new Date(since).getTime() + n * 86_400_000);

  it('shows once a week in weeks one to four, not before or after', () => {
    expect(standardNudgeWeek(base, 5, day(3))).toBeNull();
    expect(standardNudgeWeek(base, 5, day(7))).toBe(1);
    expect(standardNudgeWeek(base, 5, day(27))).toBe(3);
    expect(standardNudgeWeek(base, 5, day(34))).toBe(4);
    expect(standardNudgeWeek(base, 5, day(35))).toBeNull();
  });

  it('stays away when dismissed this week, when nothing is left, or with an own plan', () => {
    expect(standardNudgeWeek({ ...base, standardNudgeDismissedWeek: 2 }, 5, day(15))).toBeNull();
    expect(standardNudgeWeek({ ...base, standardNudgeDismissedWeek: 2 }, 5, day(22))).toBe(3);
    expect(standardNudgeWeek(base, 0, day(10))).toBeNull();
    expect(standardNudgeWeek({ ...base, contextMode: 'own' }, 5, day(10))).toBeNull();
  });
});
