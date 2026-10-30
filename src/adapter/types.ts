// One interface for every language model provider. Step 1 ships a fake implementation;
// real providers (Anthropic, OpenAI-compatible, ...) are added in step 2.

import type { Prompt } from '../prompts/loader';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  json?: unknown;
  usage: Usage;
}

/** What is actually sent, kept so the prompt library can show the last request. */
export interface SentRequest {
  promptId: string;
  promptVersion: string;
  model: string;
  system: string;
  user: string;
  at: string;
}

export interface LlmAdapter {
  /** Provider id, e.g. "fake", "anthropic", "openai-compatible". */
  readonly provider: string;
  readonly model: string;
  /** True when text never leaves the user's own devices. */
  readonly local: boolean;
  /**
   * Low level call with already rendered text. `errorFeedback` is set on the retry after
   * an invalid answer, so the provider can include it.
   */
  send(req: { system: string; user: string; temperature: number; maxOutputTokens: number; json: boolean; errorFeedback?: string }): Promise<{ text: string; usage: Usage }>;
}

export interface Completer {
  complete(prompt: Prompt, variables: Record<string, string>): Promise<CompletionResult>;
}
