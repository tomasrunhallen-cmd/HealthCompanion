// Language model settings, token use and the cost estimate. Pure functions; the
// repository stores the values and platform/secrets keeps the key.

import { addDays } from '../analysis/dates';
import { PROVIDERS, isLocalUrl, normalizeBaseUrl, type ProviderId } from '../adapter/providers';
import type { DateKey } from '../domain/types';
import type { Usage } from '../adapter/types';

export interface ModelTestResult {
  at: string;
  provider: ProviderId;
  model: string;
  baseUrl: string;
  passed: number;
  total: number;
}

export interface LlmConfig {
  /** Null means no language model: word matching on the phone. */
  provider: ProviderId | null;
  model: string;
  /** Model for sorting crisis plan headings the rules do not know. Empty: the same as `model`. Same provider and key. */
  importModel: string;
  /** Only for the OpenAI-compatible provider. */
  baseUrl: string;
  /** Set when the user has read where the text goes, for exactly this provider and address. */
  consentFor: string | null;
  /** Price in kronor per million tokens, entered by the user. Never hard-coded. */
  priceInPerMillion: number | null;
  priceOutPerMillion: number | null;
  lastTest: ModelTestResult | null;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: null,
  model: '',
  importModel: '',
  baseUrl: '',
  consentFor: null,
  priceInPerMillion: null,
  priceOutPerMillion: null,
  lastTest: null,
};

/** Identifies where text goes. Changing provider or address asks for consent again. */
export function destinationKey(provider: ProviderId, baseUrl: string): string {
  const url = provider === 'openai-compatible' ? normalizeBaseUrl(baseUrl) : PROVIDERS[provider].baseUrl;
  return `${provider}|${url}`;
}

export function hasConsent(c: Pick<LlmConfig, 'provider' | 'baseUrl' | 'consentFor'>): boolean {
  return !!c.provider && c.consentFor === destinationKey(c.provider, c.baseUrl);
}

/** True when text stays on the user's own devices (a home server on the local network). */
export function isLocalDestination(provider: ProviderId, baseUrl: string): boolean {
  return provider === 'openai-compatible' && isLocalUrl(baseUrl);
}

/** Token use per evening date. */
export type UsageLog = Record<DateKey, Usage>;

export function addUsage(log: UsageLog, date: DateKey, u: Usage): UsageLog {
  const prev = log[date] ?? { inputTokens: 0, outputTokens: 0 };
  return { ...log, [date]: { inputTokens: prev.inputTokens + u.inputTokens, outputTokens: prev.outputTokens + u.outputTokens } };
}

/** Drops entries older than `keepDays`, so the log stays small. */
export function pruneUsage(log: UsageLog, today: DateKey, keepDays = 60): UsageLog {
  const cutoff = addDays(today, -keepDays);
  return Object.fromEntries(Object.entries(log).filter(([d]) => d > cutoff));
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  /** Kronor for the last 30 days, or null when the user has not entered prices. */
  kronor: number | null;
}

/** Tokens actually used the last 30 days, times the user's own prices. */
export function estimateMonthlyCost(
  log: UsageLog,
  today: DateKey,
  prices: Pick<LlmConfig, 'priceInPerMillion' | 'priceOutPerMillion'>,
): CostEstimate {
  const from = addDays(today, -29);
  let inputTokens = 0;
  let outputTokens = 0;
  for (const [d, u] of Object.entries(log)) {
    if (d < from || d > today) continue;
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
  }
  const { priceInPerMillion: pin, priceOutPerMillion: pout } = prices;
  const kronor = pin == null || pout == null ? null : (inputTokens * pin + outputTokens * pout) / 1_000_000;
  return { inputTokens, outputTokens, kronor };
}

/** The model the crisis plan import uses: its own setting, or the evening model. */
export function importModelOf(c: Pick<LlmConfig, 'model' | 'importModel'>): string {
  return c.importModel?.trim() || c.model.trim();
}
