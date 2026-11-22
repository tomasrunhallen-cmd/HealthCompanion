// Granskning 22 november: every emergency phrase is judged in its own context. The sentences are
// invented; a clinical reviewer should judge the examples.
import type { FetchLike } from '../src/adapter/http';
import { akutCheck } from '../src/core/context/akut';
import { destinationKey } from '../src/llm/config';
import { setSecret } from '../src/platform/secrets';
import { sendChat } from '../src/services/chat';
import { saveCheckin } from '../src/services/checkin';
import { LLM_KEY_NAME } from '../src/services/llm';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

jest.mock('../src/platform/secrets', () => {
  const mem = new Map<string, string>();
  return { secretsPersist: false, getSecret: async (n: string) => mem.get(n) ?? null, setSecret: async (n: string, v: string) => void mem.set(n, v), deleteSecret: async (n: string) => void mem.delete(n) };
});

const NOW = new Date('2026-11-22T20:00:00');
const FULL = ['Min vän vill dö men jag vill dö också', 'För tio år sedan mådde jag bra men nu vill jag dö', 'Min vän vill dö och jag vill dö också'];
const MILD = ['Min vän vill dö', 'För tio år sedan ville jag dö'];

async function withModel() {
  const repo = await Repository.create(memoryBackend());
  await repo.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest', consentFor: destinationKey('mistral', '') });
  await setSecret(LLM_KEY_NAME, 'mk');
  let calls = 0;
  const fetch: FetchLike = async () => { calls++; return { ok: true, status: 200, text: async () => '{}' }; };
  return { repo, fetch, calls: () => calls };
}

describe('the emergency rule, one occurrence at a time', () => {
  it.each(FULL)('"%s" gives the full help', (t) => expect(akutCheck(t).level).toBe('full'));
  it.each(MILD)('"%s", only about someone else or the past, still gives the milder help', (t) => expect(akutCheck(t).level).toBe('mild'));

  it.each(FULL)('the check-in with "%s" shows the full help and calls no model', async (t) => {
    const m = await withModel();
    const { assessment } = await saveCheckin(m.repo, { transcript: t, mood: null, energy: null, wordsPerMinute: null }, NOW, { fetch: m.fetch });
    expect(assessment.akut).toBe(true);
    expect(m.calls()).toBe(0);
  });

  it.each(FULL)('Prata with "%s" sends nothing and shows the help', async (t) => {
    const m = await withModel();
    const turn = await sendChat(m.repo, null, t, { fetch: m.fetch, now: () => NOW });
    expect(turn.kind).toBe('akut');
    expect(m.calls()).toBe(0);
  });
});
