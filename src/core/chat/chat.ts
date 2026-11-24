// Prata (experimental): a conversation with the language model the person has connected. The
// code decides everything that matters for safety: the emergency rule runs on the phone before
// anything is sent, all text is scrubbed, the reply is checked, and what the model wants the app
// to remember is only a proposal the person approves. The model never sets a level.

import { loadPrompt, type Prompt } from '../prompts/loader';
import type { ContextKind, Suggestion } from '../domain/types';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  text: string;
  at: string;
  /** The emergency rule matched this message: 'full' was never sent, 'mild' was sent with the help shown. */
  akut?: 'full' | 'mild';
  /** The model's reply broke a rule and was replaced by the app's own text. */
  replaced?: boolean;
}

export interface ChatSession {
  id: string;
  startedAt: string;
  messages: ChatMessage[];
}

export interface SorkCard {
  id: string;
  createdAt: string;
  sessionId: string;
  situation: string;
  organism: string;
  reaktion: string;
  konsekvens: string;
  /** Saved by the model as a draft; only a card the person approved follows into the next conversation. Missing: a card from before 22 November, treated as a draft. */
  approvedAt?: string | null;
}

/** The person's own description of the conversation, the editable part of the prompt. */
export interface ChatPromptOverride {
  text: string;
  savedAt: string;
  /** Earlier versions, newest first. */
  history: { text: string; savedAt: string }[];
}

export const CHAT_HISTORY_MESSAGES = 20;
export const CHAT_PROMPT_HISTORY = 10;
export const CHAT_MESSAGE_MAX = 2000;

/** The fixed frame and the standard description. */
export function chatPrompts(): { frame: Prompt; standard: Prompt } {
  return { frame: loadPrompt('samtal-ram'), standard: loadPrompt('samtal') };
}

/** The text that goes in the frame: the person's own when there is one, else the standard. */
export function roleText(override: ChatPromptOverride | null | undefined): string {
  const own = override?.text.trim();
  return own || chatPrompts().standard.system.trim();
}

/** "samtal-ram 1.0.0 + samtal 1.0.0", or "+ egen text" with its date. */
export function promptVersionLabel(override: ChatPromptOverride | null | undefined): string {
  const { frame, standard } = chatPrompts();
  return `${frame.meta.id} ${frame.meta.version} + ${override?.text.trim() ? `egen text ${override.savedAt.slice(0, 10)}` : `${standard.meta.id} ${standard.meta.version}`}`;
}

/** The fixed part as the person sees it, with where their own text goes. */
export function frameForDisplay(): string {
  return chatPrompts().frame.system.replace('{{roll}}', '[Din text, nedan]').trim();
}

/** What the code does whatever the prompt says: shown with the frame. */
export const CODE_PROTECTIONS = [
  'Akutregeln körs på telefonen innan något skickas. Vid allvarliga ord skickas meddelandet inte, och Hjälp nu visas.',
  'Namn, telefonnummer, adresser och liknande tas bort ur all text innan den skickas.',
  'Svar med diagnoser, råd om mediciner eller doser, eller en nivå ersätts med appens egen text.',
  'Samtalet ändrar aldrig trafikljuset.',
  'Det modellen vill att appen minns blir förslag som du själv godkänner.',
];

export function historyText(messages: ChatMessage[]): string {
  const sent = messages.filter((m) => m.akut !== 'full').slice(-CHAT_HISTORY_MESSAGES);
  if (!sent.length) return '(samtalet börjar nu)';
  return sent.map((m) => `${m.role === 'user' ? 'Personen' : 'Du'}: ${m.text}`).join('\n');
}

// ---- the reply ----

// \b is ASCII only in JavaScript, so Swedish words get explicit letter boundaries.
const L = '[a-zåäöéü]';
const word = (body: string) => new RegExp(`(?<!${L})(?:${body})(?!${L})`, 'i');
const DIAGNOSIS = word('du\\s+(?:är|verkar(?:\\s+vara)?|låter|har\\s+blivit|blir)\\s+(?:nog\\s+|lite\\s+|ganska\\s+)?(?:manisk|hypoman|deprimerad|psykotisk|bipolär)');
const DOSE = word('\\d+(?:[,.]\\d+)?\\s?(?:mg|milligram|tabletter)');
const MEDICATION_ADVICE = word('(?:öka|minska|sänk|sänka|höj|höja|sluta\\s+(?:med|ta)|hoppa\\s+över|halvera|dubbla|ändra|trappa\\s+(?:ner|ut|upp))[^.!?]{0,40}(?:medicin|mediciner|medicinen|dos|dosen|tablett|tabletter|litium|lamotrigin|quetiapin|valproat|olanzapin|aripiprazol|sömnmedel)');
const LEVEL = word('(?:gul|röd|grön|gult|rött|grönt)\\s+(?:nivå|ljus)|trafikljuset\\s+(?:är|blir|borde)');

export const REPLACED_REPLY = 'Det kan jag inte svara på här. Frågor om diagnos och mediciner tar du med din vård, och nivån räknar appen själv. Vill du berätta mer om hur du har det just nu?';

/** Null when the reply may be shown; otherwise why it may not. */
export function replyProblem(text: string): 'diagnosis' | 'medication' | 'level' | null {
  if (DIAGNOSIS.test(text)) return 'diagnosis';
  if (DOSE.test(text) || MEDICATION_ADVICE.test(text)) return 'medication';
  if (LEVEL.test(text)) return 'level';
  return null;
}

export interface ChatAnswer {
  svar: string;
  minne: { slag: 'trigger' | 'routine' | 'typical_phrase' | 'course'; text: string; citat: string }[];
  sork: { situation: string; organism: string; reaktion: string; konsekvens: string };
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[”“"'.!?]/g, '').trim();

/**
 * The model's memory lines as proposals. A line counts only when its quote stands in what the
 * person wrote in this conversation, so the model cannot put words in the person's mouth, and
 * never when the bank or a pending proposal already holds the same text.
 */
export function memorySuggestions(
  a: Pick<ChatAnswer, 'minne'>,
  userTexts: string[],
  existing: { texts: string[]; keys: string[] },
  sessionId: string,
  now: Date,
): Suggestion[] {
  const said = norm(userTexts.join(' \n '));
  const known = new Set(existing.texts.map(norm));
  const out: Suggestion[] = [];
  for (const m of a.minne) {
    const text = m.text.trim();
    const quote = m.citat.trim();
    if (!text || !quote || norm(quote).length < 4 || !said.includes(norm(quote))) continue;
    const key = `chat:${m.slag}:${norm(text)}`;
    if (known.has(norm(text)) || existing.keys.includes(key) || out.some((s) => s.key === key)) continue;
    out.push({
      id: `sug_chat_${now.getTime()}_${out.length}`,
      key,
      type: 'chat',
      status: 'pending',
      createdAt: now.toISOString(),
      decidedAt: null,
      change: { action: 'add', kind: m.slag as ContextKind, text },
      reason: `Från ett samtal i Prata ${now.toISOString().slice(0, 10)}.`,
      quotes: [quote],
      source: 'chat',
      sessionId,
    });
  }
  return out;
}

/** A SORK card when the model filled it in; the situation and at least one more part are needed. */
export function sorkFrom(a: Pick<ChatAnswer, 'sork'>, sessionId: string, now: Date): SorkCard | null {
  const s = a.sork;
  const parts = [s.situation, s.organism, s.reaktion, s.konsekvens].map((x) => x.trim());
  if (!parts[0] || parts.slice(1).every((x) => !x)) return null;
  return { id: `sork_${now.getTime()}`, createdAt: now.toISOString(), sessionId, situation: parts[0], organism: parts[1], reaktion: parts[2], konsekvens: parts[3], approvedAt: null };
}

/** The four parts in plain Swedish, as the card shows them (Situation, Organism, Reaktion, Konsekvens). */
export const SORK_LABELS = ['Vad hände', 'Hur du mådde då', 'Vad du tänkte, kände och gjorde', 'Vad som hände sedan'] as const;

export function sorkText(c: SorkCard): string {
  const [s, o, r, k] = SORK_LABELS;
  return [`${s}: ${c.situation}`, c.organism && `${o}: ${c.organism}`, c.reaktion && `${r}: ${c.reaktion}`, c.konsekvens && `${k}: ${c.konsekvens}`].filter(Boolean).join('\n');
}

/** A conversation's name in the list: its first words, or "Nytt samtal". */
export function sessionTitle(s: ChatSession): string {
  const first = s.messages.find((m) => m.role === 'user' && m.akut !== 'full')?.text.replace(/\s+/g, ' ').trim();
  if (!first) return s.messages.some((m) => m.akut === 'full') ? 'Samtal där Hjälp nu visades' : 'Nytt samtal';
  return first.length > 48 ? `${first.slice(0, 47).trimEnd()}…` : first;
}

/** What the button "Gå igenom en händelse" sends: the model then starts the steps with a plain question. */
export const SORK_STARTER = 'Jag vill gå igenom en händelse steg för steg.';

/** Openers on an empty conversation, so it does not start with a blank page. */
export const CHAT_OPENERS = ['Jag vill prata om hur dagen varit', 'Något har hänt som jag funderar på', 'Jag har svårt att sova', 'Hjälp mig hitta ett litet steg i dag'];
