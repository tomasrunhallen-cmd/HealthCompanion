// Real provider adapters. They call the provider directly from the phone with the
// user's own key; there is no server in between.
//
// Verified against the providers' documentation on 2026-10-30 (see README):
// - Anthropic: POST {base}/v1/messages, headers x-api-key and anthropic-version
//   2023-06-01, system as a top-level field, JSON through output_config.format
//   (type json_schema), answer in the content block of type "text",
//   usage.input_tokens / usage.output_tokens. API version 2026-10-21 removes
//   temperature, so the older version is used and temperature is dropped if a model
//   rejects it.
// - Mistral: POST {base}/chat/completions with Bearer key, OpenAI-style messages,
//   response_format {"type":"json_object"} for JSON mode (the prompt must also ask
//   for JSON, which ours do), answer in choices[0].message.content.
// - OpenAI-compatible: same request shape as Mistral. JSON mode is dropped if the
//   server rejects response_format; our validator still checks every answer.

import { PROVIDERS, isLocalUrl, normalizeBaseUrl, type ProviderId } from './providers';
import { toProviderSchema } from '../core/llm/schema';
import type { LlmAdapter, SendRequest, Usage } from '../core/llm/types';

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type LlmErrorKind = 'auth' | 'not_found' | 'rate_limit' | 'bad_request' | 'server' | 'network' | 'timeout' | 'empty';

export class LlmHttpError extends Error {
  constructor(readonly kind: LlmErrorKind, message: string, readonly status: number | null = null, readonly detail = '') {
    super(message);
    this.name = 'LlmHttpError';
  }
}

export interface AdapterConfig {
  provider: ProviderId;
  model: string;
  apiKey: string | null;
  /** Only used by the OpenAI-compatible provider; the others have fixed addresses. */
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Adds the header Anthropic requires for calls from a web browser (web preview only). */
  browser?: boolean;
}

const ANTHROPIC_VERSION = '2023-06-01';

function userText(req: SendRequest): string {
  return req.errorFeedback ? `${req.user}\n\n${req.errorFeedback}` : req.user;
}

function errorFor(status: number, body: string, label: string): LlmHttpError {
  let detail = body.slice(0, 400);
  try {
    const j = JSON.parse(body);
    detail = String(j?.error?.message ?? j?.message ?? j?.detail ?? detail);
  } catch {
    /* keep raw text */
  }
  if (status === 401 || status === 403) return new LlmHttpError('auth', `${label} godtog inte nyckeln.`, status, detail);
  if (status === 404) return new LlmHttpError('not_found', `${label} hittade inte modellen eller adressen. Kontrollera modellnamnet.`, status, detail);
  if (status === 429) return new LlmHttpError('rate_limit', `${label} säger att det blivit för många anrop, eller att krediten är slut.`, status, detail);
  if (status >= 500) return new LlmHttpError('server', `${label} svarar inte som vanligt just nu (fel ${status}).`, status, detail);
  return new LlmHttpError('bad_request', `${label} avvisade anropet (fel ${status}): ${detail}`, status, detail);
}

async function post(
  cfg: AdapterConfig,
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const doFetch: FetchLike = cfg.fetch ?? ((u, i) => fetch(u, i));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), cfg.timeoutMs ?? 60_000) : null;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new LlmHttpError('timeout', `${label} svarade inte i tid.`);
    throw new LlmHttpError('network', `Ingen kontakt med ${label}. Kontrollera nätet och adressen.`, null, String((e as Error)?.message ?? e));
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) throw errorFor(res.status, text, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmHttpError('bad_request', `${label} gav ett svar som inte gick att läsa.`, res.status, text.slice(0, 200));
  }
}

/** True when a 400 error is about the named request parameter, so we can retry without it. */
function rejects(e: unknown, param: string): boolean {
  return e instanceof LlmHttpError && e.kind === 'bad_request' && e.detail.toLowerCase().includes(param);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function anthropicAdapter(cfg: AdapterConfig): LlmAdapter {
  const label = PROVIDERS.anthropic.label;
  const base = normalizeBaseUrl(cfg.baseUrl || PROVIDERS.anthropic.baseUrl);
  let sendTemperature = true;
  return {
    provider: 'anthropic',
    model: cfg.model,
    local: false,
    async send(req) {
      if (!cfg.apiKey) throw new LlmHttpError('auth', `${label} behöver en nyckel.`);
      const headers: Record<string, string> = { 'x-api-key': cfg.apiKey, 'anthropic-version': ANTHROPIC_VERSION };
      if (cfg.browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';
      const build = () => {
        const body: Record<string, unknown> = {
          model: cfg.model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages: [{ role: 'user', content: userText(req) }],
        };
        if (sendTemperature) body.temperature = req.temperature;
        if (req.json && req.schema) {
          body.output_config = { format: { type: 'json_schema', schema: toProviderSchema(req.schema) } };
        }
        return body;
      };
      let data: any;
      try {
        data = await post(cfg, label, `${base}/v1/messages`, headers, build());
      } catch (e) {
        if (!sendTemperature || !rejects(e, 'temperature')) throw e;
        sendTemperature = false;
        data = await post(cfg, label, `${base}/v1/messages`, headers, build());
      }
      const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
      const text = blocks.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('');
      if (!text) throw new LlmHttpError('empty', `${label} gav ett tomt svar.`);
      const usage: Usage = { inputTokens: num(data?.usage?.input_tokens), outputTokens: num(data?.usage?.output_tokens) };
      return { text, usage };
    },
  };
}

/** Chat Completions shape, used by Mistral and every OpenAI-compatible server. */
export function chatCompletionsAdapter(cfg: AdapterConfig): LlmAdapter {
  const info = PROVIDERS[cfg.provider];
  const label = cfg.provider === 'openai-compatible' ? 'Servern' : info.label;
  const base = normalizeBaseUrl(cfg.provider === 'openai-compatible' ? cfg.baseUrl ?? '' : cfg.baseUrl || info.baseUrl);
  let jsonMode = true;
  return {
    provider: cfg.provider,
    model: cfg.model,
    local: cfg.provider === 'openai-compatible' && isLocalUrl(base),
    async send(req) {
      if (!base) throw new LlmHttpError('not_found', 'Ingen adress är angiven.');
      if (info.keyRequired && !cfg.apiKey) throw new LlmHttpError('auth', `${label} behöver en nyckel.`);
      const headers: Record<string, string> = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
      const build = () => {
        const body: Record<string, unknown> = {
          model: cfg.model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: userText(req) },
          ],
          temperature: req.temperature,
          max_tokens: req.maxOutputTokens,
        };
        if (req.json && jsonMode) body.response_format = { type: 'json_object' };
        return body;
      };
      let data: any;
      try {
        data = await post(cfg, label, `${base}/chat/completions`, headers, build());
      } catch (e) {
        if (!(req.json && jsonMode && rejects(e, 'response_format'))) throw e;
        jsonMode = false;
        data = await post(cfg, label, `${base}/chat/completions`, headers, build());
      }
      const content = data?.choices?.[0]?.message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content) ? content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : '';
      if (!text) throw new LlmHttpError('empty', `${label} gav ett tomt svar.`);
      const usage: Usage = {
        inputTokens: num(data?.usage?.prompt_tokens ?? data?.usage?.input_tokens),
        outputTokens: num(data?.usage?.completion_tokens ?? data?.usage?.output_tokens),
      };
      return { text, usage };
    },
  };
}

export function createAdapter(cfg: AdapterConfig): LlmAdapter {
  return cfg.provider === 'anthropic' ? anthropicAdapter(cfg) : chatCompletionsAdapter(cfg);
}
