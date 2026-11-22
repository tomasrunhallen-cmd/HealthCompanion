// The privacy view says where data is kept in the mode the person is in, and nothing that is false there.
import { storageText } from '../src/core/privacy/storageText';

describe('storage text per mode', () => {
  it('the web version with an account never says there is no server or account', () => {
    const t = storageText({ kind: 'cloud', encrypted: null });
    expect(t.mode).toBe('Webbversionen med konto');
    expect(`${t.heading} ${t.where} ${t.encryption}`).not.toMatch(/ingen server|inget konto|den här telefonen/);
    expect(t.where).toContain('Firebase');
    expect(t.encryption).toContain('på');
  });

  it('the app on the phone and the preview say no server, each about its own device', () => {
    expect(storageText({ kind: 'sqlite', encrypted: true })).toMatchObject({ where: expect.stringContaining('den här telefonen'), encryption: 'Kryptering: på (SQLCipher).' });
    const preview = storageText({ kind: 'browser', encrypted: false });
    expect(preview.where).toContain('den här webbläsaren');
    expect(preview.where).not.toContain('telefonen');
    expect(preview.encryption).toContain('av');
  });
});
