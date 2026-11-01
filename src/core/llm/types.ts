// One interface for every language model provider. Implementations: fake.ts (offline)
// and http.ts (Anthropic, Mistral, any OpenAI-compatible address).

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

export interface SendRequest {
  system: string;
  user: string;
  temperature: number;
  maxOutputTokens: number;
  json: boolean;
  /** JSON schema for providers with schema-constrained output. Our own validator always runs too. */
  schema?: unknown;
  /** Short name of the schema, e.g. "analys". */
  schemaName?: string;
  /** Set on the retry after an invalid answer, so the provider can include it. */
  errorFeedback?: string;
}

export interface LlmAdapter {
  /** Provider id, e.g. "fake", "anthropic", "mistral", "openai-compatible". */
  readonly provider: string;
  readonly model: string;
  /** True when text never leaves the user's own devices. */
  readonly local: boolean;
  /** Low level call with already rendered text. */
  send(req: SendRequest): Promise<{ text: string; usage: Usage }>;
}

export interface CompleteOptions {
  /** Extra checks after the schema, e.g. that every id sent comes back. Errors give the same retry. */
  check?: (json: unknown) => string[];
}

export interface Completer {
  complete(prompt: Prompt, variables: Record<string, string>, options?: CompleteOptions): Promise<CompletionResult>;
}
