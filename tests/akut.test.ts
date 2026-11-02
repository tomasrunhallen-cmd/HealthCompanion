import type { FetchLike } from '../src/adapter/http';
import { explainAssessment } from '../src/core/analysis/explain';
import {
  akutCheck, akutCheckWith, akutLevel, akutLists, akutMatches, akutPhrases, crisisInfo, isAkut, parseAkut, parseAkutLists, splitAkutLines,
} from '../src/core/context/akut';
import { buildContext } from '../src/core/context/buildContext';
import { startWithStandard } from '../src/services/standard';
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

describe('negation gives a mild match, not none', () => {
  it('a negation between the words or just before the phrase makes the match mild', () => {
    expect(akutLevel('Jag vill inte dö.')).toBe('mild');
    expect(akutLevel('Jag vill inte dö, jag är bara trött')).toBe('mild');
    expect(akutLevel('Jag tänker inte göra mig illa')).toBe('mild');
    expect(akutLevel('Har aldrig haft självmordstankar')).toBe('mild');
  });

  it('the new phrases match in full', () => {
    expect(akutLevel('Jag vet inte om jag orkar leva')).toBe('full');
    expect(akutLevel('Vill inte vara med längre')).toBe('full');
    expect(akutLevel('Orkar inte finnas')).toBe('full');
    expect(akutLevel('Jag vill inte leva')).toBe('full');
  });

  it('a negation in another clause does not soften a full match, and full wins over mild', () => {
    expect(akutLevel('Mår inte bra, vill dö')).toBe('full');
    expect(akutLevel('Det gick inte. Vill dö.')).toBe('full');
    expect(akutCheck('Jag vill inte dö. Men jag vill inte leva heller.')).toMatchObject({ level: 'full', phrases: ['vill inte leva'] });
    expect(akutLevel('Lugn dag, inte mycket hände')).toBeNull();
  });

  it('negated crisis plan lines also stay on the phone', () => {
    expect(splitAkutLines('- Tänker inte göra mig illa\n- Sover mindre').akut).toEqual(['Tänker inte göra mig illa']);
  });
});

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

  it('reads phrases, core words and exceptions as separate lists', () => {
    const src = '---\nid: a\nversion: 1\n---\n## Fraser\n- vill dö\n## Kärnord\n- självmord\n## Undantag\n- för mig själv';
    expect(parseAkutLists(src)).toEqual({ phrases: ['vill dö'], cores: ['självmord'], exceptions: ['för mig själv'] });
  });
});

describe('core words match as the start of a compound', () => {
  it.each([
    'Har haft självmordstankar hela kvällen.',
    'Jag har gjort självmordsplaner.',
    'Tänker på mitt självmordsförsök.',
    'Känner en stark dödslängtan.',
    'Det är bara livsleda just nu.',
    'Har suicidtankar igen.',
    'Fick dödstankar på bussen.',
    'Har självskadebeteende igen.',
    'Funderar på självmordet.',
  ])('"%s" gives the full crisis card', (note) => {
    expect(akutLevel(note)).toBe('full');
  });

  it('an old attempt still gives a full match: better a false alarm than a miss', () => {
    expect(akutLevel('Tänkte på mitt självmordsförsök för tio år sedan.')).toBe('full');
  });

  it('a negation before a core word gives a mild match, as for phrases', () => {
    expect(akutLevel('Har aldrig haft självmordstankar')).toBe('mild');
    expect(akutLevel('Ingen dödslängtan i dag')).toBe('mild');
  });

  it('a core word must start the word: "själv" alone is not "självmord"', () => {
    expect(akutLevel('Satt mest för mig själv på lunchen.')).toBeNull();
    expect(akutLevel('Lagade middag själv och gick en promenad.')).toBeNull();
    expect(akutLevel('Kände mig lite skadeglad i dag.')).toBeNull();
  });
});

describe('the exception list for known false hits', () => {
  it('"för mig själv" gives no match', () => {
    expect(akutLevel('Ville vara för mig själv i kväll.')).toBeNull();
    expect(akutLists().exceptions).toContain('för mig själv');
  });

  it('"jag skärper mig" is not taken as an inflection of "skär mig"', () => {
    expect(akutLevel('Nu skärper jag mig. I morgon skärper mig och går tidigt.')).toBeNull();
    expect(akutLevel('Jag skärpte mig på mötet.')).toBeNull();
    // Without the exception the same words would match.
    const lists = { phrases: ['skär mig'], cores: [], exceptions: [] };
    expect(akutCheckWith('Jag skärpte mig på mötet.', lists).level).toBe('full');
    expect(akutCheckWith('Jag skärpte mig på mötet.', { ...lists, exceptions: ['skärpte mig'] }).level).toBeNull();
  });

  it('an exception does not hide a real phrase in the same note', () => {
    expect(akutLevel('Satt för mig själv. Ville skada mig själv.')).toBe('full');
    expect(akutLevel('Jag skär mig, jag skärper mig inte.')).toBe('full');
  });

  it('real inflections still match', () => {
    expect(isAkut('Har skadat mig själv igen')).toBe(true);
    expect(isAkut('Jag skar mig i går')).toBe(true);
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
      repo, { transcript: 'Orkar inte mer. Jag vill inte leva.', mood: -2, energy: 2, wordsPerMinute: null }, NOW,
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
    const { assessment } = await saveCheckin(repo, { transcript: 'Jag vill sova för evigt.', mood: -2, energy: 3, wordsPerMinute: null }, NOW, { fetch: online as unknown as FetchLike }, { fetch: online as unknown as GarminFetch });
    expect(online).not.toHaveBeenCalled();
    expect(assessment.level).toBe('red');
  });

  it('"Jag vill inte dö" shows the mild card, the day is not red, nothing is sent to the model', async () => {
    const repo = await connectedRepo();
    const llm = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
    const garmin = counting();
    const { entry, assessment } = await saveCheckin(repo, { transcript: 'Jag vill inte dö, jag är bara trött.', mood: -1, energy: 3, wordsPerMinute: null }, NOW, { fetch: llm as unknown as FetchLike }, { fetch: garmin });
    expect(llm).not.toHaveBeenCalled();
    expect(assessment).toMatchObject({ akutMild: true, method: 'wordmatch', model: null });
    expect(assessment.akut).toBeUndefined();
    expect(assessment.level).not.toBe('red');
    expect(assessment.signals.some((s) => s.kind === 'akut')).toBe(false);
    expect(crisisInfo(repo.plan()).numbers.map((n) => n.number)).toEqual(['112', '1177', '90101']);
    expect(explainAssessment(entry, assessment, null).data).toContain('Anteckningen nämnde tankar på att inte vilja leva, med en negation. Krisrutan visades, men dagen räknades som vanligt. Anteckningen skickades inte till någon språkmodell');
  });

  it('"Jag vill inte leva" gives a red day and the full card without network', async () => {
    const repo = await connectedRepo();
    const offline = counting();
    const { assessment } = await saveCheckin(repo, { transcript: 'Jag vill inte leva.', mood: -2, energy: 2, wordsPerMinute: null }, NOW, { fetch: offline }, { fetch: offline });
    expect(offline.calls).toBe(0);
    expect(assessment).toMatchObject({ akut: true, level: 'red', levelReason: 'akut' });
    expect(assessment.akutMild).toBeUndefined();
  });

  it('the user\'s emergency phrases never go into the prompt variables', async () => {
    const repo = await connectedRepo();
    await repo.addPlanItems([{ id: 'a1', kind: 'akut', text: 'vill sova för evigt' }]);
    const entry = { id: 'e', date: '2026-11-01', createdAt: NOW.toISOString(), kind: 'checkin' as const, transcript: 'Vanlig dag.', mood: 0, energy: 5, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null };
    const ctx = buildContext({ entries: repo.contextEntries(), entry, history: [] });
    expect(JSON.stringify(ctx.variables)).not.toContain('evigt');
    expect(ctx.signs.map((s) => s.text)).toEqual(['Svarar inte på sms']);
    for (const p of akutPhrases().slice(0, 5)) expect(JSON.stringify(ctx.variables)).not.toContain(p);
  });

  it('gives red also in standard mode, where standard rows alone never do', async () => {
    const repo = await Repository.create(memoryBackend());
    await startWithStandard(repo, NOW);
    const { assessment } = await saveCheckin(repo, { transcript: 'Har självmordstankar.', mood: -2, energy: 2, wordsPerMinute: null }, NOW);
    expect(assessment).toMatchObject({ akut: true, level: 'red' });
    expect(crisisInfo(repo.plan()).steps).toContain('Kontakta din vårdkontakt i dag');
  });

  it('an ordinary note is not affected', async () => {
    const repo = await Repository.create(memoryBackend());
    const { assessment } = await saveCheckin(repo, { transcript: 'Lugn dag.', mood: 0, energy: 5, wordsPerMinute: null }, NOW);
    expect(assessment.akut).toBeUndefined();
    expect(assessment.level).toBe('green');
  });
});
