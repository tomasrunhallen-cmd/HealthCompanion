import { createCompleter, InvalidAnswerError } from '../src/adapter/complete';
import { echoAnalysisAdapter, fixedAdapter } from '../src/adapter/fake';
import { extractJson, validate, type SchemaNode } from '../src/adapter/schema';
import { assessEntry } from '../src/analysis/assess';
import { createLlmMatcher } from '../src/analysis/llmMatcher';
import { loadTestSuite } from '../src/analysis/testcases';
import { fill, listPrompts, loadPrompt, loadSchema, parsePrompt, render, variablesIn } from '../src/prompts/loader';

describe('prompt loader', () => {
  it('loads all five prompt files with id and version', () => {
    const ids = listPrompts().map((p) => p.meta.id).sort();
    expect(ids).toEqual(['analys', 'aterbesok', 'historik-import', 'krisplan-import', 'testfall']);
    for (const p of listPrompts()) expect(p.meta.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('parses frontmatter types and sections', () => {
    const p = loadPrompt('analys');
    expect(p.meta).toMatchObject({ id: 'analys', version: '1.2.0', temperature: 0, max_output_tokens: 400, response: 'json', schema: 'schemas/analys.json' });
    expect(p.system).toContain('Svara bara med JSON');
    expect(variablesIn(p.user).sort()).toEqual(['anteckning', 'dagligt', 'grund', 'matvarden', 'normallage', 'profil', 'rattelser', 'tecken']);
  });

  it('every JSON prompt points to an existing schema', () => {
    for (const p of listPrompts().filter((x) => x.meta.response === 'json')) {
      expect(loadSchema(p.meta.schema!)).toBeTruthy();
    }
  });

  it('fills variables and refuses missing ones', () => {
    expect(fill('Hej {{namn}}!', { namn: 'du' })).toBe('Hej du!');
    expect(() => fill('Hej {{namn}}', {})).toThrow('Variabel saknas: namn');
  });

  it('rejects a prompt without frontmatter', () => {
    expect(() => parsePrompt('# System\nhej')).toThrow();
  });

  it('renders system and user separately', () => {
    const r = render(loadPrompt('analys'), { normallage: 'N', matvarden: 'M', grund: 'G', profil: 'P', dagligt: 'D', rattelser: 'R', tecken: '1. T', anteckning: 'A' });
    expect(r.user).toContain('Dagens anteckning (rensad):\nA');
    expect(r.system).not.toContain('{{');
  });
});

describe('schema validation', () => {
  const schema = loadSchema('schemas/analys.json') as SchemaNode;
  it('accepts a valid answer', () => {
    expect(validate({ matches: [{ sign_id: 1, quote: 'x' }], sentence: 'En mening.' }, schema)).toEqual([]);
  });
  it('rejects wrong types and unknown fields', () => {
    expect(validate({ matches: [{ sign_id: '1', quote: 'x' }], sentence: 'x' }, schema).length).toBeGreaterThan(0);
    expect(validate({ matches: [], sentence: 'x', level: 'red' }, schema)).toEqual(['$.level: okänt fält']);
  });
  it('extracts JSON from fenced answers', () => {
    expect(extractJson('Här:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe('adapter with fake implementation', () => {
  it('retries once with the error attached, then succeeds', async () => {
    const fake = fixedAdapter(['inte json', '{"matches":[],"sentence":"Inget i anteckningen avviker från ditt normalläge."}']);
    const res = await createCompleter(fake).complete(loadPrompt('analys'), { normallage: '', matvarden: '', grund: '', profil: '', dagligt: '', rattelser: '', tecken: '', anteckning: '' });
    expect(res.json).toEqual({ matches: [], sentence: 'Inget i anteckningen avviker från ditt normalläge.' });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].errorFeedback).toContain('följde inte schemat');
  });

  it('throws after two invalid answers so the app can fall back', async () => {
    const fake = fixedAdapter(['{"matches":"nej"}']);
    await expect(createCompleter(fake).complete(loadPrompt('analys'), { normallage: '', matvarden: '', grund: '', profil: '', dagligt: '', rattelser: '', tecken: '', anteckning: '' }))
      .rejects.toBeInstanceOf(InvalidAnswerError);
  });

  it('never sends unscrubbed names to the model', async () => {
    const fake = fixedAdapter(['{"matches":[],"sentence":"ok"}']);
    const matcher = createLlmMatcher({ completer: createCompleter(fake), model: 'fake', names: () => ['Kim'] });
    await matcher.match('Kim ringde, 070-1234567', [], { normalState: '', sleepThresholdHours: 5 });
    expect(fake.calls[0].user).toContain('[NAMN] ringde, [TELEFON]');
    expect(fake.calls[0].user).not.toContain('Kim');
  });

  it('drops matches whose quote is not in the note', async () => {
    const fake = fixedAdapter(['{"matches":[{"sign_id":1,"quote":"helt påhittat"}],"sentence":"x"}']);
    const matcher = createLlmMatcher({ completer: createCompleter(fake), model: 'fake', names: () => [] });
    const r = await matcher.match('Vanlig dag.', [{ id: 's1', kind: 'early', text: 'Sover mindre', order: 0, approvedAt: '' }], { normalState: '', sleepThresholdHours: 5 });
    expect(r.matches).toEqual([]);
  });

  it('the four test cases pass through the full LLM path with the fake model', async () => {
    const suite = loadTestSuite();
    const matcher = createLlmMatcher({ completer: createCompleter(echoAnalysisAdapter()), model: 'fake-analys', names: () => [] });
    for (const c of suite.cases) {
      const a = await assessEntry({ entry: c.entry, plan: suite.plan, planSettings: suite.planSettings, history: c.history, matcher });
      expect({ id: c.id, level: a.level }).toEqual({ id: c.id, level: c.expected });
      expect(a.method).toBe('llm');
      expect(a.promptVersion).toBe('1.2.0');
    }
  });
});
