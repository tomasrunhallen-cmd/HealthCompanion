// Prata on the phone: the conversation, its memory proposals and SORK cards, and the editable
// description of the conversation. See src/core/chat/chat.ts for what the code guarantees.

import {
  CHAT_MESSAGE_MAX, CHAT_PROMPT_HISTORY, chatPrompts, historyText, memorySuggestions, promptVersionLabel, REPLACED_REPLY, replyProblem, roleText, sorkFrom, sorkText,
  type ChatAnswer, type ChatMessage, type ChatPromptOverride, type ChatSession, type SorkCard,
} from '../core/chat/chat';
import { buildContext } from '../core/context/buildContext';
import { akutCheck, akutLevel } from '../core/context/akut';
import { eveningDateKey, formatDateSv } from '../core/analysis/dates';
import { findingTitle } from '../core/analysis/moodPatterns';
import { changeHeadline, STABLE_TITLE } from '../core/analysis/rhythm';
import type { ContextEntry, Entry, Level } from '../core/domain/types';
import { scrub } from '../core/privacy/scrub';
import type { Repository } from '../storage/repository';
import { activeAdapter, namesToScrub, trackedCompleter, type AdapterOptions } from './llm';
import { shownFindings } from './moodPatterns';
import { latestRhythm } from './rhythm';

export const CHAT_SESSION_PREFIX = 'chat:';
export const SORK_KEY = 'sorkCards';
export const CHAT_PROMPT_KEY = 'chatPrompt';

const LEVEL_WORD: Record<Level, string> = { green: 'grön', yellow: 'gul', red: 'röd' };
const NOTES_SENT = 7;
const NOTE_MAX = 600;

// ---- stored state ----

export function chatSessions(repo: Repository): ChatSession[] {
  return repo.kvKeys(CHAT_SESSION_PREFIX).map((k) => repo.kvGet(k) as ChatSession).filter((s) => s && Array.isArray(s.messages))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export const CHAT_CURRENT_KEY = 'chatCurrent';

export function latestSession(repo: Repository): ChatSession | null {
  return chatSessions(repo)[0] ?? null;
}

/** The conversation open in Prata: the one last chosen, else the newest. */
export function currentSession(repo: Repository): ChatSession | null {
  const id = repo.kvGet(CHAT_CURRENT_KEY) as string | undefined;
  return (id ? chatSessions(repo).find((s) => s.id === id) : null) ?? latestSession(repo);
}

export async function openSession(repo: Repository, id: string): Promise<void> {
  await repo.kvSet(CHAT_CURRENT_KEY, id);
}

export async function newSession(repo: Repository, now = new Date()): Promise<ChatSession> {
  const s: ChatSession = { id: `s${now.getTime()}`, startedAt: now.toISOString(), messages: [] };
  await repo.kvSet(`${CHAT_SESSION_PREFIX}${s.id}`, s);
  await repo.kvSet(CHAT_CURRENT_KEY, s.id);
  return s;
}

export async function deleteSession(repo: Repository, id: string): Promise<void> {
  await repo.kvRemove(`${CHAT_SESSION_PREFIX}${id}`);
}

export function sorkCards(repo: Repository): SorkCard[] {
  return ((repo.kvGet(SORK_KEY) as SorkCard[] | undefined) ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The person approves a draft: only then does it follow into the next conversation. */
export async function approveSork(repo: Repository, id: string, now = new Date()): Promise<void> {
  await repo.kvSet(SORK_KEY, sorkCards(repo).map((c) => (c.id === id ? { ...c, approvedAt: now.toISOString() } : c)));
}

export async function deleteSork(repo: Repository, id: string): Promise<void> {
  await repo.kvSet(SORK_KEY, sorkCards(repo).filter((c) => c.id !== id));
}

export function chatPromptOverride(repo: Repository): ChatPromptOverride | null {
  return (repo.kvGet(CHAT_PROMPT_KEY) as ChatPromptOverride | undefined) ?? null;
}

/** Saves the person's own description; an empty text, or the standard text, goes back to the standard. */
export async function saveChatPrompt(repo: Repository, text: string, now = new Date()): Promise<void> {
  const prev = chatPromptOverride(repo);
  const t = text.trim();
  const standard = chatPrompts().standard.system.trim();
  const history = prev?.text.trim() ? [{ text: prev.text, savedAt: prev.savedAt }, ...prev.history].slice(0, CHAT_PROMPT_HISTORY) : prev?.history ?? [];
  await repo.kvSet(CHAT_PROMPT_KEY, { text: t === standard ? '' : t, savedAt: now.toISOString(), history } satisfies ChatPromptOverride);
}

// ---- what the model gets ----

/** Everything in the app the conversation may use, as one text, before scrubbing. */
export function chatContext(repo: Repository, now = new Date()): string {
  const date = eveningDateKey(now);
  const bank = repo.contextEntries();
  const history = repo.history();
  const today: Entry = history.find((h) => h.entry.date === date)?.entry ?? {
    id: 'chat', date, createdAt: now.toISOString(), kind: 'checkin', transcript: '', mood: null, energy: null, wordsPerMinute: null, sleepHours: null, sleepSource: null, stressAvg: null,
  } as Entry;
  const built = buildContext({ entries: bank, entry: today, history, garmin: repo.garminDays() }, repo.planSettings());
  const v = built.variables;
  // A plan row with emergency words keeps its type in the plan, but is not sent: the model gets
  // only that there is one (granskning 22 november).
  const of = (kind: ContextEntry['kind']) => bank.filter((e) => e.kind === kind).map((e) => `- ${akutLevel(e.text) ? '(en rad om akut fara, skickas inte)' : e.text}`);
  const block = (title: string, lines: string[]) => (lines.length ? [`${title}:`, ...lines, ''] : []);
  const last = [...history].sort((a, b) => b.entry.date.localeCompare(a.entry.date))[0];
  const level = last?.level ? `Senaste avstämningen (${formatDateSv(last.entry.date)}): ${LEVEL_WORD[last.level]} enligt appens regler.` : 'Ingen avstämning ännu.';
  // A check-in the emergency rule stopped is never sent later as background, nor one whose words
  // the rule would stop today.
  const stopped = new Set(repo.assessments().filter((a) => a.akut || a.akutMild).map((a) => a.entryId));
  const userPhrases = repo.contextOf('akut').map((e) => e.text);
  const notes = [...history].filter((h) => h.entry.transcript.trim() && !stopped.has(h.entry.id) && !akutCheck(h.entry.transcript, userPhrases).level).sort((a, b) => b.entry.date.localeCompare(a.entry.date)).slice(0, NOTES_SENT)
    .map((h) => `- ${formatDateSv(h.entry.date)}${h.entry.mood != null ? ` (stämning ${h.entry.mood})` : ''}: ${h.entry.transcript.trim().slice(0, NOTE_MAX)}`);
  const rhythm = latestRhythm(repo);
  const rhythmLine = rhythm ? (rhythm.status === 'change' ? changeHeadline(rhythm.changes) : rhythm.status === 'stable' ? STABLE_TITLE : 'För lite data') : null;
  const patterns = shownFindings(repo).map((f) => `- ${findingTitle(f.result)}`);
  const sork = sorkCards(repo).filter((c) => c.approvedAt).slice(0, 3).map((c) => `- ${formatDateSv(c.createdAt.slice(0, 10))}: ${sorkText(c).replace(/\n/g, '; ')}`);
  return [
    level, '',
    `Normalläge: ${v.normallage}`, '',
    ...block('Tidiga tecken', of('early')),
    ...block('Allvarliga tecken', of('serious')),
    ...block('Steg ur planen vid gult', of('action_yellow')),
    ...block('Steg ur planen vid rött', of('action_red')),
    ...block('Rutiner', of('routine')),
    ...block('Värdeankare', of('value_anchor')),
    'Mätvärden:', v.matvarden, '',
    v.grund, '', v.profil, '', v.dagligt, '',
    ...block('Senaste anteckningarna', notes),
    ...(rhythmLine ? [`Dygnsrytm (experimentell, ur klockan): ${rhythmLine}`, ''] : []),
    ...block('Mina mönster (samband i egna data, inte orsaker)', patterns),
    ...block('Tidigare SORK-analyser', sork),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---- one turn ----

export type ChatTurn =
  | { kind: 'akut'; session: ChatSession }
  | { kind: 'reply'; session: ChatSession; mild: boolean; suggestions: number; sork: SorkCard | null }
  | { kind: 'no_model'; session: ChatSession }
  | { kind: 'failed'; session: ChatSession; message: string }
  | { kind: 'too_long'; length: number; max: number };

async function saveSession(repo: Repository, s: ChatSession): Promise<void> {
  await repo.kvSet(`${CHAT_SESSION_PREFIX}${s.id}`, s);
}

/**
 * The person's message, checked by the emergency rule first. Full: saved, never sent, and the
 * help is shown. Otherwise sent, scrubbed, with the app's context; the reply is checked before it
 * is shown, memory lines become proposals, and a confirmed SORK analysis becomes a card.
 */
export async function sendChat(repo: Repository, sessionId: string | null, text: string, opts: AdapterOptions = {}): Promise<ChatTurn> {
  const now = opts.now?.() ?? new Date();
  // The emergency rule reads the whole text, before any limit: the end of a long message can
  // never be cut away unread (granskning 23 november).
  const message = text.trim();
  const check = akutCheck(message, repo.contextOf('akut').map((e) => e.text));
  // Too long and not stopped by the rule: nothing is saved or sent; the draft stays for the person to shorten.
  if (check.level !== 'full' && message.length > CHAT_MESSAGE_MAX) return { kind: 'too_long', length: message.length, max: CHAT_MESSAGE_MAX };
  let session = (sessionId ? (repo.kvGet(`${CHAT_SESSION_PREFIX}${sessionId}`) as ChatSession | undefined) : null) ?? await newSession(repo, now);
  const user: ChatMessage = { role: 'user', text: message, at: now.toISOString(), ...(check.level ? { akut: check.level } : {}) };
  const before = session.messages;
  session = { ...session, messages: [...before, user] };
  await saveSession(repo, session);
  if (check.level === 'full') return { kind: 'akut', session };

  const adapter = await activeAdapter(repo, opts);
  if (!adapter) return { kind: 'no_model', session };
  const names = namesToScrub(repo);
  const clean = (t: string) => scrub(t, names).text;
  const { frame } = chatPrompts();
  let answer: ChatAnswer;
  try {
    const res = await trackedCompleter(repo, adapter, opts.now).complete(frame, {
      // The person's own description is scrubbed too: a name on the list must not go out through it.
      roll: clean(roleText(chatPromptOverride(repo))),
      sammanhang: clean(chatContext(repo, now)),
      historik: clean(historyText(before)),
      meddelande: clean(message),
    });
    answer = res.json as ChatAnswer;
  } catch (e) {
    return { kind: 'failed', session, message: (e as Error).message || 'Modellen svarade inte.' };
  }
  const problem = replyProblem(answer.svar);
  const reply: ChatMessage = { role: 'assistant', text: problem ? REPLACED_REPLY : answer.svar.trim(), at: new Date(now.getTime() + 1).toISOString(), ...(problem ? { replaced: true } : {}) };
  session = { ...session, messages: [...session.messages, reply] };
  await saveSession(repo, session);

  const userTexts = session.messages.filter((m) => m.role === 'user').map((m) => clean(m.text));
  const proposals = problem ? [] : memorySuggestions(answer, userTexts, { texts: repo.contextEntries().map((e) => e.text), keys: repo.suggestions().filter((s) => s.status === 'pending').map((s) => s.key) }, session.id, now);
  if (proposals.length) await repo.saveSuggestions([...repo.suggestions(), ...proposals]);
  const card = problem ? null : sorkFrom(answer, session.id, now);
  if (card) await repo.kvSet(SORK_KEY, [card, ...sorkCards(repo)]);
  return { kind: 'reply', session, mild: check.level === 'mild', suggestions: proposals.length, sork: card };
}

export function chatPromptLabel(repo: Repository): string {
  return promptVersionLabel(chatPromptOverride(repo));
}
