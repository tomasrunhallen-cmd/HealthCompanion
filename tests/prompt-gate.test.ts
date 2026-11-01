import { loadPrompt } from '../src/prompts/loader';
import { analysFingerprint, readApproval } from './promptGate';

// "En ändrad prompt måste klara alla fall innan den checkas in." npm test runs before every
// commit (AGENTS.md); this test fails as soon as prompts/analys.md or its schema changes,
// until `npm run prompt:check` has run every case against a real model and written a new
// approval to prompts/godkand.json.
describe('the analys prompt gate', () => {
  const approval = readApproval();

  it('the prompt and schema are the ones that were approved', () => {
    const now = analysFingerprint();
    if (now !== approval.sha256) {
      throw new Error(
        'prompts/analys.md or schemas/analys.json has changed since it last passed every test case. ' +
          'Run `npm run prompt:check` with a model key (see README) and commit the updated prompts/godkand.json.',
      );
    }
  });

  it('the approval names the prompt version it was given for', () => {
    expect(approval.version).toBe(loadPrompt('analys').meta.version);
  });

  it('an approval from a model means every case passed', () => {
    if (approval.status === 'godkänd') {
      expect(approval.model).toBeTruthy();
      expect(approval.passed).toBe(approval.total);
    } else {
      expect(approval.status).toBe('utgångsläge');
    }
  });
});
