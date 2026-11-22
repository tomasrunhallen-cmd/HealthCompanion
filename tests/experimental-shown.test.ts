// Rules 1.9.0: during the first clinical evaluation, experimental signals are shown, never counted.
import { RULES } from '../src/core/analysis/rules';
import { textPatternSignals } from '../src/core/analysis/scoring';
import { rhythmMode } from '../src/services/rhythm';
import { memoryBackend } from '../src/storage/backend';
import { Repository } from '../src/storage/repository';

describe('experimental signals in show mode', () => {
  it('is the rule by default', () => expect(RULES.experimentalInLevel).toBe(false));

  it('Dygnsrytm chosen as "Använd i bedömningen" is only shown', async () => {
    const repo = await Repository.create(memoryBackend());
    await repo.updateSettings({ rhythm: 'use' });
    expect(rhythmMode(repo)).toBe('show');
  });

  it('a pattern from earlier texts is listed with why, and gives no point', () => {
    const r = textPatternSignals([{ patternId: 'p1', description: 'Många planer på en gång', quote: 'tre nya projekt', phenomenon: 'thinking', direction: 'up' } as never], []);
    expect(r.signals).toHaveLength(0);
    expect(r.outcomes[0]).toMatchObject({ counted: false, reason: expect.stringContaining('första kliniska utvärderingen') });
  });
});
