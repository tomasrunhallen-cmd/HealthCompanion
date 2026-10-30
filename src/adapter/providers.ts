// The language model providers the user can pick. Model names are free text: the
// suggestions are only shortcuts, so a newer model can be used without a new app version.
// Prices are never hard-coded; the user enters them (see llm/usage.ts).

export type ProviderId = 'mistral' | 'anthropic' | 'openai-compatible';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Default base URL. The OpenAI-compatible provider needs the user's own. */
  baseUrl: string;
  /** True when the user must type the base URL. */
  needsBaseUrl: boolean;
  /** True when a key is required. A home server may run without one. */
  keyRequired: boolean;
  modelSuggestions: string[];
  /** Where the provider's own terms for storage and training are published. */
  termsUrl: string | null;
  keyHelp: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    needsBaseUrl: false,
    keyRequired: true,
    modelSuggestions: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'],
    termsUrl: 'https://mistral.ai/terms',
    keyHelp: 'Skapa en nyckel under API Keys på console.mistral.ai.',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    needsBaseUrl: false,
    keyRequired: true,
    modelSuggestions: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    termsUrl: 'https://www.anthropic.com/legal/commercial-terms',
    keyHelp: 'Skapa en nyckel under API keys på platform.claude.com.',
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-kompatibel adress',
    baseUrl: '',
    needsBaseUrl: true,
    keyRequired: false,
    modelSuggestions: [],
    termsUrl: null,
    keyHelp:
      'Till exempel Ollama eller LM Studio på din dator (http://192.168.x.x:11434/v1), OpenRouter eller OpenAI (https://api.openai.com/v1). Nyckel behövs inte för en egen server utan lösenord.',
  },
};

export const PROVIDER_ORDER: ProviderId[] = ['mistral', 'anthropic', 'openai-compatible'];

/**
 * True when the address points at the user's own network: localhost, private IPv4
 * ranges or a .local name. Then text never leaves the user's own devices.
 */
export function isLocalUrl(url: string): boolean {
  const m = url.trim().match(/^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/i);
  if (!m) return false;
  const host = m[1].toLowerCase();
  if (host === 'localhost' || host === '[::1]' || host.endsWith('.local')) return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
