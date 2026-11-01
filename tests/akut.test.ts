import type { FetchLike } from '../src/adapter/http';
import { explainAssessment } from '../src/analysis/explain';
import { akutMatches, akutPhrases, crisisInfo, isAkut, parseAkut, splitAkutLines } from '../src/context/akut';
import { buildContext } from '../src/context/buildContext';
import { startWithStandard } from '../src/context/standard';
import type { GarminFetch } from '../src/garmin/client';
import { destinationKey } from '../src/llm/config';
import { setSecret } from '../src/platform/secrets';
import { saveCheckin } from '../src/services/checkin';
import { GARMIN_KEY_NAME } from '../src/services/garmin';
import { LLM_KEY_NAME } from '../src/services/llm';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

jest.mock('../src/platform/secrets', () => {
  const mem = new Map<string, string>();
  return {
    secretsPersist: false,
    getSecret: async (n: string) => mem.get(n) ?? null,
    setSecret: async (n: string, v: string) => void mem.set(n, v),
    deleteSecret: async (n: string) => void mem.delete(n),
  };
});

const NOW = new Date(2026, 10, 1, 21, 0);

describe('emergency word list', () => {
  it('is read from context/akut.md', () => {
    expect(akutPhrases().length).toBeGreaterThan(20);
    expect(parseAkut('---\nid: a\nversion: 1\n---\n## Annat\n- nej\n## Fraser\n- vill dö')).toEqual(['vill dö']);
  });

  it('matches inflections and words in between, but not a negation in between', () => {
    expect(isAkut('Jag vill inte leva längre.')).toBe(true);
    expect(isAkut('jag vill verkligen inte leva')).toBe(true);
    expect(isAkut('Har haft självmordstankar hela dagen')).toBe(true);
    expect(isAkut('Tänker på att skada mig själv')).toBe(true);
    expect(isAkut('Det vore bättre om jag inte fanns')).toBe(true);
    expect(isAkut('Jag vill inte dö, jag är bara trött')).toBe(false);
    expect(isAkut('Lugn dag. Ville ta det lugnt.')).toBe(false);
    expect(isAkut('')).toBe(false);
  });

  it('includes the user\'s own phrases from the crisis plan', () => {
    expect(isAkut('Allt känns grått och jag vill sova för evigt')).toBe(false);
    expect(akutMatches('Allt känns grått och jag vill sova för evigt', ['vill sova för evigt'])).toEqual(['vill sova för evigt']);
  });

  it('keeps emergency lines of a crisis plan away from the model', () => {
    const { kept, akut } = splitAkutLines('Tidiga tecken\n- Sover mindre\n- Tankar på att ta mitt liv\nVid rött\n- Ring mottagningen');
    expect(kept).toBe('Tidiga tecken\n- Sover mindre\nVid rött\n- Ring mottagningen');
    expect(akut).toEqual(['Tankar på att ta mitt liv']);
  });
});

function counting(): FetchLike & GarminFetch & { calls: number } {
  const f = (async () => {
    f.calls++;
    throw new TypeError('Network request failed');
  }) as unknown as FetchLike & GarminFetch & { calls: number };
  f.calls = 0;
  return f;
}

async function connectedRepo() {
  const repo = await Repository.create(memoryBackend());
  await repo.addPlanItems([
    { id: 's1', kind: 'early', text: 'Svarar inte på sms' },
    { id: 'r1', kind: 'action_red', text: 'Ring mottagningen' },
    { id: 'r2', kind: 'action_red', text: 'Be Kim komma hit' },
  ]);
  await repo.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest', consentFor: destinationKey('mistral', '') });
  await setSecret(LLM_KEY_NAME, 'mk');
  await setSecret(GARMIN_KEY_NAME, 'gk');
  await repo.updateGarminStatus({ connected: true, lastSyncAt: null, lastError: null });
  return repo;
}

describe('the emergency rule in a check-in', () => {
  it('shows the crisis numbers with the network off, without any network call', async () => {
    const repo = await connectedRepo();
    const offline = counting();
    const { entry, assessment } = await saveCheckin(
      repo, { transcript: 'Orkar inte mer. Jag vill inte leva.', mood: 2, energy: 2, wordsPerMinute: null }, NOW,
      { fetch: offline }, { fetch: offline },
    );
    expect(offline.calls).toBe(0);
    expect(assessment).toMatchObject({ akut: true, level: 'red', levelReason: 'akut', method: 'wordmatch', model: null });
    expect(assessment.signals[0]).toMatchObject({ kind: 'akut' });
    const card = crisisInfo(repo.plan());
    expect(card.numbers.map((n) => n.number)).toEqual(['112', '1177', '90101']);
    expect(card.numbers.find((n) => n.number === '90101')?.label).toContain('Självmordslinjen');
    expect(card.steps).toEqual(['Ring mottagningen', 'Be Kim komma hit']);
    const why = explainAssessment(entry, assessment, null);
    expect(why.conclusion).toContain('visar appen alltid rött och krisnumren');
    expect(why.data).toContain('Anteckningen jämfördes bara på telefonen. Den skickades inte till någon språkmodell');
  });

  it('never sends the note or the list to the model, also with the network on', async () => {
    const repo = await connectedRepo();
    await repo.addPlanItems([{ id: 'a1', kind: 'akut', text: 'vill sova för evigt' }]);
    const online = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
    const { assessment } = await saveCheckin(repo, { transcript: 'Jag vill sova för evigt.', mood: 3, energy: 3, wordsPerMinute: null }, NOW, { fetch: online as unknown as FetchLike }, { fetch: online as unknown as GarminFetch });
    expect(online).not.toHaveBeenCalled();
    expect(assessment.level).toBe('red');
  });

  it('the user\'s emergency phrases never go into the prompt variables', async () => {
    const repo = await connectedRepo();
    await repo.addPlanItems([{ id: 'a1', kind: 'akut', text: 'vill sova för evigt' }]);
    const entry = { id: 'e', date: '2026-11-01', createdAt: NOW.toISOString(), kind: 'checkin' as const, transcript: 'Vanlig dag.', mood: 5, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null };
    const ctx = buildContext({ entries: repo.contextEntries(), entry, history: [] });
    expect(JSON.stringify(ctx.variables)).not.toContain('evigt');
    expect(ctx.signs.map((s) => s.text)).toEqual(['Svarar inte på sms']);
    for (const p of akutPhrases().slice(0, 5)) expect(JSON.stringify(ctx.variables)).not.toContain(p);
  });

  it('gives red also in standard mode, where standard rows alone never do', async () => {
    const repo = await Repository.create(memoryBackend());
    await startWithStandard(repo, NOW);
    const { assessment } = await saveCheckin(repo, { transcript: 'Har självmordstankar.', mood: 2, energy: 2, wordsPerMinute: null }, NOW);
    expect(assessment).toMatchObject({ akut: true, level: 'red' });
    expect(crisisInfo(repo.plan()).steps).toContain('Kontakta din vårdkontakt i dag');
  });

  it('an ordinary note is not affected', async () => {
    const repo = await Repository.create(memoryBackend());
    const { assessment } = await saveCheckin(repo, { transcript: 'Lugn dag.', mood: 5, energy: 5, wordsPerMinute: null }, NOW);
    expect(assessment.akut).toBeUndefined();
    expect(assessment.level).toBe('green');
  });
});
