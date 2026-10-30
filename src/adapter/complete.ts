// Turns any LlmAdapter into complete(prompt, variables) -> { text, json?, usage }:
// render the prompt, call the provider, validate JSON against the schema, retry once
// with the error attached, otherwise throw so the caller falls back to word matching.

import { loadSchema, render, type Prompt } from '../prompts/loader';
import { extractJson, validate, type SchemaNode } from './schema';
import type { CompletionResult, Completer, LlmAdapter, SentRequest } from './types';

export class InvalidAnswerError extends Error {
  constructor(message: string, readonly errors: string[]) {
    super(message);
    this.name = 'InvalidAnswerError';
  }
}

export function createCompleter(adapter: LlmAdapter, onSent?: (req: SentRequest) => void): Completer {
  return {
    async complete(prompt: Prompt, variables: Record<string, string>): Promise<CompletionResult> {
      const rendered = render(prompt, variables);
      const wantsJson = prompt.meta.response === 'json';
      const schema = wantsJson && prompt.meta.schema ? (loadSchema(prompt.meta.schema) as SchemaNode) : null;
      const base = {
        system: rendered.system,
        user: rendered.user,
        temperature: Number(prompt.meta.temperature ?? 0),
        maxOutputTokens: Number(prompt.meta.max_output_tokens ?? 400),
        json: wantsJson,
      };
      onSent?.({
        promptId: prompt.meta.id, promptVersion: prompt.meta.version, model: adapter.model,
        system: rendered.system, user: rendered.user, at: new Date().toISOString(),
      });

      let usage = { inputTokens: 0, outputTokens: 0 };
      let feedback: string | undefined;
      let lastErrors: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await adapter.send({ ...base, errorFeedback: feedback });
        usage = { inputTokens: usage.inputTokens + res.usage.inputTokens, outputTokens: usage.outputTokens + res.usage.outputTokens };
        if (!wantsJson) return { text: res.text, usage };
        try {
          const json = extractJson(res.text);
          lastErrors = schema ? validate(json, schema) : [];
          if (lastErrors.length === 0) return { text: res.text, json, usage };
        } catch (e) {
          lastErrors = [(e as Error).message];
        }
        feedback = `Ditt förra svar följde inte schemat: ${lastErrors.join('; ')}. Svara bara med giltig JSON.`;
      }
      throw new InvalidAnswerError('Modellens svar följde inte schemat', lastErrors);
    },
  };
}
