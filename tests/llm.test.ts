import { createCompleter } from '../src/adapter/complete';
import { fixedAdapter, referenceAdapter } from '../src/adapter/fake';
import { loadTestSuite } from '../src/analysis/testcases';
import { anthropicAdapter, chatCompletionsAdapter, LlmHttpError, type FetchLike } from '../src/adapter/http';
import { isLocalUrl } from '../src/adapter/providers';
import { toProviderSchema } from '../src/adapter/schema';
import { loadPrompt, loadSchema } from '../src/prompts/loader';
import { DEFAULT_LLM_CONFIG, destinationKey, estimateMonthlyCost, hasConsent, pruneUsage } from '../src/llm/config';
import { restorePlaceholders, scrubReversible } from '../src/privacy/scrub';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';
import { setSecret, deleteSecret } from '../src/platform/secrets';
import {
  activeAdapter, currentMatcher, differingCases, LLM_KEY_NAME, namesToScrub, runModelTest, structurePlanWithModel,
} from '../src/services/llm';
import { saveCheckin } from '../src/services/checkin';
import { wordMatcher } from '../src/analysis/assess';

// jest-expo resolves the .native file; replace Keychain with memory for the tests.
jest.mock('../src/platform/secrets', () => {
  const mem = new Map<string, string>();
  return {
    secretsPersist: false,
    getSecret: async (n: string) => mem.get(n) ?? null,
    setSecret: async (n: string, v: string) => void mem.set(n, v),
    deleteSecret: async (n: string) => void mem.delete(n),
  };
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function fakeFetch(responses: { status: number; body: unknown }[]): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { ok: r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) };
  }) as FetchLike & { calls: Call[] };
  f.calls = calls;
  return f;
}

const REQ = { system: 'S', user: 'U', temperature: 0, maxOutputTokens: 400, json: true, schema: loadSchema('schemas/analys.json'), schemaName: 'analys' };
const ANSWER = '{"matches":[],"sentence":"Inget i anteckningen avviker från ditt normalläge."}';

describe('Anthropic adapter', () => {
  it('sends the documented request shape and reads the text block and usage', async () => {
    const f = fakeFetch([{ status: 200, body: { content: [{ type: 'text', text: ANSWER }], usage: { input_tokens: 120, output_tokens: 30 } } }]);
    const a = anthropicAdapter({ provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'sk-test', fetch: f });
    const res = await a.send(REQ);
    expect(res).toEqual({ text: ANSWER, usage: { inputTokens: 120, outputTokens: 30 } });
    const c = f.calls[0];
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.headers['x-api-key']).toBe('sk-test');
    expect(c.headers['anthropic-version']).toBe('2023-06-01');
    expect(c.headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
    expect(c.body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 400, system: 'S', temperature: 0, messages: [{ role: 'user', content: 'U' }] });
    expect(c.body.output_config.format.type).toBe('json_schema');
    // Anthropic rejects length limits in the schema; they are stripped for the provider only.
    expect(JSON.stringify(c.body.output_config.format.schema)).not.toMatch(/maxLength|minLength|minimum|\$schema/);
    expect(a.local).toBe(false);
  });

  it('retries without temperature when the model rejects it', async () => {
    const f = fakeFetch([
      { status: 400, body: { error: { message: 'temperature: Extra inputs are not permitted' } } },
      { status: 200, body: { content: [{ type: 'text', text: ANSWER }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ]);
    const a = anthropicAdapter({ provider: 'anthropic', model: 'm', apiKey: 'k', fetch: f });
    await a.send(REQ);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1].body.temperature).toBeUndefined();
  });

  it('maps a rejected key to a Swedish error', async () => {
    const f = fakeFetch([{ status: 401, body: { error: { message: 'invalid x-api-key' } } }]);
    const a = anthropicAdapter({ provider: 'anthropic', model: 'm', apiKey: 'bad', fetch: f });
    await expect(a.send(REQ)).rejects.toMatchObject({ kind: 'auth', message: 'Anthropic (Claude) godtog inte nyckeln.' });
  });

  it('refuses to call without a key', async () => {
    const f = fakeFetch([]);
    await expect(anthropicAdapter({ provider: 'anthropic', model: 'm', apiKey: null, fetch: f }).send(REQ)).rejects.toBeInstanceOf(LlmHttpError);
    expect(f.calls).toHaveLength(0);
  });
});

describe('Mistral and OpenAI-compatible adapter', () => {
  it('sends chat completions with JSON mode to Mistral', async () => {
    const f = fakeFetch([{ status: 200, body: { choices: [{ message: { role: 'assistant', content: ANSWER } }], usage: { prompt_tokens: 200, completion_tokens: 40 } } }]);
    const a = chatCompletionsAdapter({ provider: 'mistral', model: 'mistral-small-latest', apiKey: 'mk', fetch: f });
    const res = await a.send({ ...REQ, errorFeedback: 'Fel.' });
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
    const c = f.calls[0];
    expect(c.url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(c.headers.authorization).toBe('Bearer mk');
    expect(c.body).toMatchObject({
      model: 'mistral-small-latest', temperature: 0, max_tokens: 400, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U\n\nFel.' }],
    });
  });

  it('uses the user\'s address, needs no key on a home server, and counts it as local', async () => {
    const f = fakeFetch([{ status: 200, body: { choices: [{ message: { content: ANSWER } }] } }]);
    const a = chatCompletionsAdapter({ provider: 'openai-compatible', model: 'qwen', apiKey: null, baseUrl: 'http://192.168.1.20:11434/v1/', fetch: f });
    await a.send(REQ);
    expect(f.calls[0].url).toBe('http://192.168.1.20:11434/v1/chat/completions');
    expect(f.calls[0].headers.authorization).toBeUndefined();
    expect(a.local).toBe(true);
  });

  it('drops JSON mode when the server rejects response_format', async () => {
    const f = fakeFetch([
      { status: 400, body: { error: { message: "'response_format.type' must be 'json_schema'" } } },
      { status: 200, body: { choices: [{ message: { content: ANSWER } }] } },
    ]);
    const a = chatCompletionsAdapter({ provider: 'openai-compatible', model: 'x', apiKey: null, baseUrl: 'http://localhost:1234/v1', fetch: f });
    await a.send(REQ);
    expect(f.calls[1].body.response_format).toBeUndefined();
  });

  it('reports network failure without leaking the key', async () => {
    const f: FetchLike = async () => { throw new TypeError('Network request failed'); };
    const a = chatCompletionsAdapter({ provider: 'mistral', model: 'm', apiKey: 'secret-key', fetch: f });
    await expect(a.send(REQ)).rejects.toMatchObject({ kind: 'network' });
    await a.send(REQ).catch((e) => expect(String(e.message)).not.toContain('secret-key'));
  });

  it('runs a whole completion with schema check through Mistral', async () => {
    const f = fakeFetch([{ status: 200, body: { choices: [{ message: { content: ANSWER } }], usage: { prompt_tokens: 5, completion_tokens: 5 } } }]);
    const usage: number[] = [];
    const completer = createCompleter(chatCompletionsAdapter({ provider: 'mistral', model: 'm', apiKey: 'k', fetch: f }), {
      onUsage: (u) => usage.push(u.inputTokens + u.outputTokens),
    });
    const res = await completer.complete(loadPrompt('analys'), { normallage: '', matvarden: '', grund: '', profil: '', dagligt: '', rattelser: '', tecken: '', anteckning: '' });
    expect(res.json).toEqual(JSON.parse(ANSWER));
    expect(usage).toEqual([10]);
  });
});

describe('providers and schema', () => {
  it('recognises addresses on the user\'s own network', () => {
    expect(isLocalUrl('http://localhost:11434/v1')).toBe(true);
    expect(isLocalUrl('http://10.0.0.5/v1')).toBe(true);
    expect(isLocalUrl('http://172.20.1.1:1234')).toBe(true);
    expect(isLocalUrl('http://datorn.local:1234/v1')).toBe(true);
    expect(isLocalUrl('https://openrouter.ai/api/v1')).toBe(false);
    expect(isLocalUrl('http://172.32.0.1')).toBe(false);
  });

  it('keeps structure and enums when stripping a schema for a provider', () => {
    const s = toProviderSchema(loadSchema('schemas/krisplan-import.json')) as any;
    expect(s.properties.rows.items.properties.kind.enum).toContain('atgard-rott');
    expect(s.properties.rows.items.additionalProperties).toBe(false);
    expect(s.properties.rows.items.properties.text.maxLength).toBeUndefined();
  });
});

describe('consent and cost', () => {
  it('asks again when provider or address changes', () => {
    const c = { ...DEFAULT_LLM_CONFIG, provider: 'mistral' as const, consentFor: destinationKey('mistral', '') };
    expect(hasConsent(c)).toBe(true);
    expect(hasConsent({ ...c, provider: 'anthropic' })).toBe(false);
    const o = { ...DEFAULT_LLM_CONFIG, provider: 'openai-compatible' as const, baseUrl: 'http://a.local/v1', consentFor: destinationKey('openai-compatible', 'http://a.local/v1/') };
    expect(hasConsent(o)).toBe(true);
    expect(hasConsent({ ...o, baseUrl: 'https://evil.example/v1' })).toBe(false);
  });

  it('estimates the month from tokens actually used and the user\'s own prices', () => {
    const log = {
      '2026-09-30': { inputTokens: 1_000_000, outputTokens: 0 }, // 31st day back: outside the 30 days
      '2026-10-02': { inputTokens: 2500, outputTokens: 400 },
      '2026-10-30': { inputTokens: 2500, outputTokens: 400 },
    };
    const none = estimateMonthlyCost(log, '2026-10-30', { priceInPerMillion: null, priceOutPerMillion: null });
    expect(none).toEqual({ inputTokens: 5000, outputTokens: 800, kronor: null });
    const est = estimateMonthlyCost(log, '2026-10-30', { priceInPerMillion: 2, priceOutPerMillion: 6 });
    expect(est.kronor).toBeCloseTo((5000 * 2 + 800 * 6) / 1e6, 10);
    expect(Object.keys(pruneUsage(log, '2026-10-30', 10))).toEqual(['2026-10-30']);
  });
});

describe('reversible scrub for the plan import', () => {
  it('numbers each value and restores it on the phone', () => {
    const r = scrubReversible('Ring Kim på 070-123 45 67. Kim vet. Sedan Robin.', ['Kim', 'Robin']);
    expect(r.text).toBe('Ring [NAMN1] på [TELEFON1]. [NAMN1] vet. Sedan [NAMN2].');
    expect(r.text).not.toMatch(/Kim|Robin|070/);
    expect(restorePlaceholders('Ring [NAMN1] på [TELEFON1]', r.map)).toBe('Ring Kim på 070-123 45 67');
    expect(restorePlaceholders('Okänd [NAMN9]', r.map)).toBe('Okänd [NAMN9]');
  });
});

describe('plan import with a model', () => {
  it('turns the answer into unapproved rows, restores names and flags invented rows', async () => {
    const original = 'Tidiga tecken\n- Svarar inte på sms\nVid gult\n- Ring Kim';
    const s = scrubReversible(original, ['Kim']);
    const fake = fixedAdapter([JSON.stringify({ rows: [
      { kind: 'tidigt', text: 'Svarar inte på sms' },
      { kind: 'atgard-gult', text: 'Ring [NAMN1]' },
      { kind: 'allvarligt', text: 'Hör röster' },
    ] })]);
    const rows = await structurePlanWithModel(createCompleter(fake), s.text, s.map, original);
    expect(fake.calls[0].user).toContain('Ring [NAMN1]');
    expect(fake.calls[0].user).not.toContain('Kim');
    expect(rows.map((r) => [r.kind, r.text, r.approved, r.inOriginal])).toEqual([
      ['early', 'Svarar inte på sms', false, true],
      ['action_yellow', 'Ring Kim', false, true],
      ['serious', 'Hör röster', false, false],
    ]);
  });
});

describe('Testa modellen', () => {
  it('approves a model that gives the reference answer in every case', async () => {
    const suite = loadTestSuite();
    const report = await runModelTest(createCompleter(referenceAdapter(suite.cases)), 'referenssvar');
    expect(report).toMatchObject({ passed: suite.cases.length, total: suite.cases.length, approved: true, suiteVersion: '2.4.0' });
    expect(report.cases.every((c) => c.ok && c.error == null)).toBe(true);
    expect(differingCases(report)).toEqual([]);
  });

  it('decides the emergency cases in code and never sends them to the model', async () => {
    const suite = loadTestSuite();
    const fake = fixedAdapter(['{"matches":[],"sentence":"x"}']);
    const report = await runModelTest(createCompleter(fake), 'm');
    const sent = fake.calls.map((c) => c.user).join('\n');
    for (const c of suite.cases.filter((x) => x.expectedAkut)) {
      expect(sent).not.toContain(c.entry.transcript);
      expect(report.cases.find((r) => r.id === c.id)).toMatchObject({ ok: true, akut: c.expectedAkut, got: c.expected });
    }
    expect(fake.calls).toHaveLength(suite.cases.filter((x) => !x.expectedAkut).length);
  });

  it('fails a case when the model does not follow the schema, and does not approve', async () => {
    const report = await runModelTest(createCompleter(fixedAdapter(['inget json här'])), 'bad');
    expect(report.approved).toBe(false);
    // Only the emergency cases pass, since they never reach the model.
    expect(report.passed).toBe(3);
    expect(report.cases[0].error).toBe('Modellens svar följde inte schemat');
  });

  it('stops after the first case when the key is wrong', async () => {
    const f = fakeFetch([{ status: 401, body: { error: { message: 'unauthorized' } } }]);
    const report = await runModelTest(createCompleter(chatCompletionsAdapter({ provider: 'mistral', model: 'm', apiKey: 'x', fetch: f })), 'm');
    expect(report.cases).toHaveLength(1);
    expect(report.cases[0].error).toBe('Mistral godtog inte nyckeln.');
    expect(report.approved).toBe(false);
    expect(f.calls).toHaveLength(1);
  });

  it('shows which cases differed when the model matches nothing', async () => {
    const report = await runModelTest(createCompleter(fixedAdapter([ANSWER])), 'blind');
    expect(report.approved).toBe(false);
    const differing = differingCases(report).map((c) => [c.id, c.expected, c.got]);
    // Every case that needs a sign from the note; measured signs, silence and medication still score.
    expect(differing).toEqual([
      ['orkade-inte-svara', 'yellow', 'green'],
      ['omskrivet-tecken', 'yellow', 'green'],
      ['allvarligt-ensamt', 'yellow', 'green'],
      ['allvarligt-plus-annat', 'red', 'green'],
      ['tva-korta-natter-tva-tecken', 'red', 'yellow'],
      ['flera-gula-dagar', 'red', 'green'],
      ['standard-allvarligt', 'yellow', 'yellow'],
    ].filter(([, e, g]) => e !== g));
  });
});

describe('the app uses the model only after consent', () => {
  afterEach(() => deleteSecret(LLM_KEY_NAME));

  it('falls back to word matching until provider, key and consent are in place', async () => {
    const repo = await Repository.create(memoryBackend());
    expect(await currentMatcher(repo)).toBe(wordMatcher);
    await repo.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest' });
    await setSecret(LLM_KEY_NAME, 'mk');
    expect(await activeAdapter(repo)).toBeNull();
    await repo.updateLlmConfig({ consentFor: destinationKey('mistral', '') });
    expect((await activeAdapter(repo))?.provider).toBe('mistral');
  });

  it('a check-in sends scrubbed text, records tokens and the sent text', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addPlanItems([
      { id: 's1', kind: 'early', text: 'Svarar inte på sms' },
      { id: 'a1', kind: 'action_yellow', text: 'Ring Kim' },
    ]);
    await repo.updateLlmConfig({ provider: 'mistral', model: 'mistral-small-latest', consentFor: destinationKey('mistral', '') });
    await setSecret(LLM_KEY_NAME, 'mk');
    expect(namesToScrub(repo)).toContain('Kim');
    const f = fakeFetch([{ status: 200, body: {
      choices: [{ message: { content: '{"matches":[{"sign_id":1,"quote":"orkade inte svara på sms"}],"sentence":"Du orkade inte svara på sms."}' } }],
      usage: { prompt_tokens: 300, completion_tokens: 50 },
    } }]);
    const now = new Date(2026, 9, 30, 21, 0);
    const { assessment } = await saveCheckin(repo, { transcript: 'Kim ringde. Jag orkade inte svara på sms.', mood: 5, energy: 5, wordsPerMinute: null }, now, { fetch: f });
    expect(f.calls[0].body.messages[1].content).toContain('[NAMN] ringde');
    expect(f.calls[0].body.messages[1].content).not.toContain('Kim');
    expect(assessment).toMatchObject({ method: 'llm', level: 'yellow', model: 'mistral-small-latest', promptId: 'analys' });
    expect(repo.usageLog()['2026-10-30']).toEqual({ inputTokens: 300, outputTokens: 50 });
    expect(repo.lastSent()?.user).toContain('[NAMN] ringde');
  });

  it('falls back to word matching and says so when the provider fails', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.addPlanItems([{ id: 's1', kind: 'early', text: 'Svarar inte på sms' }]);
    await repo.updateLlmConfig({ provider: 'mistral', model: 'm', consentFor: destinationKey('mistral', '') });
    await setSecret(LLM_KEY_NAME, 'mk');
    const f = fakeFetch([{ status: 500, body: {} }]);
    const { assessment } = await saveCheckin(repo, { transcript: 'Svarar inte på sms.', mood: 5, energy: 5, wordsPerMinute: null }, new Date(2026, 9, 30, 21), { fetch: f });
    expect(assessment).toMatchObject({ method: 'llm_fallback', level: 'yellow' });
  });
});
