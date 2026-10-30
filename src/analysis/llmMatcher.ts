// Sign matcher that asks a language model through the adapter, using prompts/analys.md.
// The note is always scrubbed first. The model only says which signs match and writes
// one sentence; the level is still computed in scoring.ts.

import type { Completer } from '../adapter/types';
import type { PlanItem, PlanSettings, SignMatch } from '../domain/types';
import { loadPrompt } from '../prompts/loader';
import { scrub } from '../privacy/scrub';
import type { MatchResult, SignMatcher } from './assess';
import { normalize } from './wordmatch';

interface AnalysAnswer {
  matches: { sign_id: number; quote: string }[];
  sentence: string;
}

export function signList(signs: PlanItem[]): string {
  return signs
    .map((s, i) => `${i + 1}. ${s.text} (${s.kind === 'serious' ? 'allvarligt' : 'tidigt'})`)
    .join('\n');
}

export function createLlmMatcher(opts: {
  completer: Completer;
  model: string;
  /** Names to scrub: the user's list plus names from the plan. */
  names: () => string[];
}): SignMatcher {
  return {
    async match(note: string, signs: PlanItem[], planSettings: PlanSettings): Promise<MatchResult> {
      const prompt = loadPrompt('analys');
      const cleanNote = scrub(note, opts.names()).text;
      const res = await opts.completer.complete(prompt, {
        normallage: scrub(planSettings.normalState || '(inte ifyllt)', opts.names()).text,
        tecken: signList(signs),
        anteckning: cleanNote,
      });
      const answer = res.json as AnalysAnswer;
      const normNote = normalize(cleanNote);
      const matches: SignMatch[] = [];
      for (const m of answer.matches) {
        const sign = signs[m.sign_id - 1];
        // Drop matches whose quote is not actually in the note: the model must not guess.
        if (!sign || !normNote.includes(normalize(m.quote))) continue;
        if (!matches.some((x) => x.planItemId === sign.id)) matches.push({ planItemId: sign.id, quote: m.quote });
      }
      return {
        matches,
        sentence: answer.sentence,
        method: 'llm',
        model: opts.model,
        promptId: prompt.meta.id,
        promptVersion: prompt.meta.version,
      };
    },
  };
}
