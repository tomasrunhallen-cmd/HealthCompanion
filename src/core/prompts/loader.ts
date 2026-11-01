// Loads versioned markdown prompts: YAML-like frontmatter, then "# System" and "# User"
// sections. Variables are written {{name}} and filled in by the app.

import { PROMPT_SOURCES, SCHEMA_SOURCES } from './bundle.generated';

export interface PromptMeta {
  id: string;
  version: string;
  temperature?: number;
  max_output_tokens?: number;
  response?: 'json' | 'markdown' | 'data';
  schema?: string;
  [key: string]: string | number | undefined;
}

export interface Prompt {
  meta: PromptMeta;
  system: string;
  user: string;
  /** The whole body after the frontmatter. */
  body: string;
  /** Original file content, for the prompt library view. */
  source: string;
}

export interface RenderedPrompt {
  meta: PromptMeta;
  system: string;
  user: string;
}

function parseScalar(raw: string): string | number {
  const v = raw.trim().replace(/^["']|["']$/g, '');
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

export function parseFrontmatter(source: string): { meta: Record<string, string | number>; body: string } {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('Prompt saknar frontmatter');
  const meta: Record<string, string | number> = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) throw new Error(`Ogiltig frontmatter-rad: ${line}`);
    meta[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1));
  }
  return { meta, body: m[2] };
}

/** Splits the body on top-level "# System" and "# User" headings. */
export function splitSections(body: string): { system: string; user: string } {
  const sections: Record<string, string> = {};
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current) sections[current] = buf.join('\n').trim();
    buf.length = 0;
  };
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^# (System|User)\s*$/);
    if (h) {
      flush();
      current = h[1].toLowerCase();
    } else if (current) {
      buf.push(line);
    }
  }
  flush();
  return { system: sections.system ?? '', user: sections.user ?? '' };
}

export function parsePrompt(source: string): Prompt {
  const { meta, body } = parseFrontmatter(source);
  if (typeof meta.id !== 'string' || meta.version === undefined) {
    throw new Error('Prompt saknar id eller version');
  }
  const { system, user } = splitSections(body);
  return {
    meta: { ...meta, id: meta.id, version: String(meta.version) } as PromptMeta,
    system,
    user,
    body,
    source,
  };
}

export function variablesIn(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/\{\{\s*([a-zA-Z0-9_åäö-]+)\s*\}\}/g), (m) => m[1])));
}

/** Fills {{name}} placeholders. Missing variables are an error, never silently empty. */
export function fill(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_åäö-]+)\s*\}\}/g, (_, name: string) => {
    if (!(name in variables)) throw new Error(`Variabel saknas: ${name}`);
    return variables[name];
  });
}

export function render(prompt: Prompt, variables: Record<string, string>): RenderedPrompt {
  return { meta: prompt.meta, system: fill(prompt.system, variables), user: fill(prompt.user, variables) };
}

export function loadPrompt(id: string): Prompt {
  const source = PROMPT_SOURCES[`prompts/${id}.md`];
  if (!source) throw new Error(`Prompten finns inte: ${id}`);
  return parsePrompt(source);
}

export function listPrompts(): Prompt[] {
  return Object.values(PROMPT_SOURCES).map(parsePrompt);
}

export function loadSchema(name: string): unknown {
  const schema = SCHEMA_SOURCES[name];
  if (!schema) throw new Error(`Schemat finns inte: ${name}`);
  return schema;
}

/** Extracts the first ```json block from a markdown body (used by testfall.md). */
export function extractJsonBlock<T>(body: string): T {
  const m = body.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) throw new Error('Inget json-block hittades');
  return JSON.parse(m[1]) as T;
}
