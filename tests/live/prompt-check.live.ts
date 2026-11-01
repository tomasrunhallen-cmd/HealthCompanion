/**
 * @jest-environment node
 */
// `npm run prompt:check`: runs every case in prompts/testfall.md against a real model and,
// only when all of them give the reference level, writes the approval to
// prompts/godkand.json. Not part of `npm test`, because it needs a key and costs tokens.
//
//   DAGSLJUS_LLM_PROVIDER=mistral DAGSLJUS_LLM_MODEL=mistral-small-latest \
//   DAGSLJUS_LLM_KEY=... npm run prompt:check
//
// DAGSLJUS_LLM_BASE_URL is needed for openai-compatible. Keep the key in the environment,
// never in a file in the repository.

import { createCompleter } from '../../src/adapter/complete';
import type { ProviderId } from '../../src/adapter/providers';
import { differingCases, runModelTest, buildAdapter } from '../../src/services/llm';
import { analysFingerprint, writeApproval } from '../promptGate';
import { nodeFetch } from './nodeFetch';

// The key comes from the environment; Keychain is never touched.
jest.mock('../../src/platform/secrets', () => ({
  secretsPersist: false,
  getSecret: async () => null,
  setSecret: async () => undefined,
  deleteSecret: async () => undefined,
}));
jest.setTimeout(10 * 60 * 1000);

const provider = process.env.DAGSLJUS_LLM_PROVIDER as ProviderId | undefined;
const model = process.env.DAGSLJUS_LLM_MODEL ?? '';

it('every test case gives the reference level with a real model', async () => {
  if (!provider || !model) {
    throw new Error('Set DAGSLJUS_LLM_PROVIDER (mistral, anthropic or openai-compatible), DAGSLJUS_LLM_MODEL and DAGSLJUS_LLM_KEY.');
  }
  const adapter = buildAdapter(
    { provider, model, baseUrl: process.env.DAGSLJUS_LLM_BASE_URL ?? '' },
    process.env.DAGSLJUS_LLM_KEY ?? null,
    { fetch: nodeFetch },
  );
  const report = await runModelTest(createCompleter(adapter), adapter.model, (done, total) => {
    process.stdout.write(`${done}/${total}\n`);
  });
  const differing = differingCases(report);
  if (!report.approved) {
    const lines = differing.map((c) => `  ${c.id}: väntat ${c.expected}, fick ${c.got ?? '–'}${c.error ? ` (${c.error})` : ''}`);
    throw new Error(`${report.passed} av ${report.total} testfall gav referensnivån. Fall som skilde sig:\n${lines.join('\n')}`);
  }
  writeApproval({
    version: report.promptVersion,
    sha256: analysFingerprint(),
    status: 'godkänd',
    testfall: report.suiteVersion,
    provider,
    model: adapter.model,
    passed: report.passed,
    total: report.total,
    date: new Date().toISOString().slice(0, 10),
    cases: report.cases.map((c) => ({ id: c.id, expected: c.expected, got: c.got })),
  });
});
