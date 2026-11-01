// Shared by the prompt gate test and `npm run prompt:check`: the fingerprint of the analys
// prompt and its schema, and the approval record in prompts/godkand.json.

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
export const APPROVAL_FILE = join(ROOT, 'prompts', 'godkand.json');
const GATED = ['prompts/analys.md', 'schemas/analys.json'];

export interface Approval {
  version: string;
  sha256: string;
  /** "godkänd": passed every case with a real model. "utgångsläge": the prompt as it was when the gate was added. */
  status: 'godkänd' | 'utgångsläge';
  testfall: string;
  provider: string | null;
  model: string | null;
  passed: number | null;
  total: number;
  date: string;
  note?: string;
  cases?: { id: string; expected: string; got: string | null }[];
}

/** SHA-256 over the gated files, with line endings normalised so Windows checkouts agree. */
export function analysFingerprint(): string {
  const h = createHash('sha256');
  for (const f of GATED) h.update(`${f}\n${readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')}\n`);
  return h.digest('hex');
}

export function readApproval(): Approval {
  return (JSON.parse(readFileSync(APPROVAL_FILE, 'utf8')) as { analys: Approval }).analys;
}

export function writeApproval(a: Approval): void {
  writeFileSync(APPROVAL_FILE, `${JSON.stringify({ analys: a }, null, 2)}\n`);
}
