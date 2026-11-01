// Fake adapter: returns fixed or computed answers without any network.
// Lets the whole app and the test suite run offline (work order point 6).

import { contentTokens, splitSentences, tokenize, wordsMatch, quoteFrom } from '../analysis/wordmatch';
import { scrub } from '../privacy/scrub';
import type { LlmAdapter, Usage } from './types';

const ZERO: Usage = { inputTokens: 0, outputTokens: 0 };

/** Always answers with the given texts, in order (the last one repeats). */
export function fixedAdapter(answers: string[]): LlmAdapter & { calls: { system: string; user: string; errorFeedback?: string }[] } {
  const calls: { system: string; user: string; errorFeedback?: string }[] = [];
  return {
    provider: 'fake',
    model: 'fake-fixed',
    local: true,
    calls,
    async send(req) {
      calls.push({ system: req.system, user: req.user, errorFeedback: req.errorFeedback });
      const text = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { text, usage: { inputTokens: Math.ceil((req.system.length + req.user.length) / 4), outputTokens: Math.ceil(text.length / 4) } };
    },
  };
}

/**
 * Understands the analys prompt's user section well enough to answer like a careful model,
 * using word matching. Good for demos: the app behaves as with an LLM, fully offline.
 */
export function echoAnalysisAdapter(): LlmAdapter {
  return {
    provider: 'fake',
    model: 'fake-analys',
    local: true,
    async send(req) {
      const signsBlock = req.user.match(/Tecken:\n([\s\S]*?)\n\n/)?.[1] ?? '';
      const note = req.user.split('Dagens anteckning (rensad):\n')[1] ?? '';
      const signs = signsBlock
        .split('\n')
        .map((l) => l.match(/^(\d+)\.\s+(.*)$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({ id: Number(m[1]), text: m[2].replace(/\s+\((tidigt|allvarligt)\)$/, '') }));
      const matches: { sign_id: number; quote: string }[] = [];
      for (const s of signs) {
        const need = contentTokens(s.text);
        if (!need.length) continue;
        for (const sentence of splitSentences(note)) {
          const words = tokenize(sentence);
          if (need.every((t) => words.some((w) => wordsMatch(w, t)))) {
            matches.push({ sign_id: s.id, quote: quoteFrom(sentence, need) });
            break;
          }
        }
      }
      const first = signs.find((s) => s.id === matches[0]?.sign_id);
      const sentence = first
        ? `Det tydligaste i dag liknar ditt tecken ”${first.text}”.`
        : 'Inget i anteckningen avviker från ditt normalläge.';
      return { text: JSON.stringify({ matches, sentence }), usage: ZERO };
    },
  };
}

/**
 * Answers each test case with its reference answer from prompts/testfall.md: the signs a
 * careful model should find, with their quotes. Used to check that the cases and the
 * scoring code agree, and as a stand-in model in `npm run prompt:check`'s own test.
 */
export function referenceAdapter(cases: { entry: { transcript: string }; reference: { sign: string; quote: string }[] | null }[]): LlmAdapter {
  return {
    provider: 'fake',
    model: 'referenssvar',
    local: true,
    async send(req) {
      const note = (req.user.split('Dagens anteckning (rensad):\n')[1] ?? '').trim();
      const numbers = new Map<string, number>();
      for (const line of (req.user.match(/Tecken:\n([\s\S]*?)\n\n/)?.[1] ?? '').split('\n')) {
        const m = line.match(/^(\d+)\.\s+(.*?)(\s+\((tidigt|allvarligt)\))?$/);
        if (m) numbers.set(m[2], Number(m[1]));
      }
      const c = cases.find((x) => x.reference && scrub(x.entry.transcript, []).text.trim() === note);
      if (!c?.reference) throw new Error(`Inget referenssvar för anteckningen: ${note.slice(0, 60)}`);
      const matches = c.reference.map((r) => ({ sign_id: numbers.get(r.sign) ?? 0, quote: r.quote }));
      const sentence = c.reference[0]
        ? `Det tydligaste i dag liknar ditt tecken ”${c.reference[0].sign}”.`
        : 'Inget i anteckningen avviker från ditt normalläge.';
      return { text: JSON.stringify({ matches, sentence }), usage: ZERO };
    },
  };
}
