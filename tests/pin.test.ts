import { checkPin, makePinRecord, validPin } from '../src/platform/pin';

describe('web app lock PIN', () => {
  const salt = new Uint8Array(16).fill(7);

  it('accepts 4 to 8 digits only', () => {
    expect(['1234', '12345678'].map(validPin)).toEqual([true, true]);
    expect(['123', '123456789', '12a4', ''].map(validPin)).toEqual([false, false, false, false]);
  });

  it('stores a salted hash, never the PIN, and checks it', () => {
    const rec = makePinRecord('2468', salt, 1000);
    expect(JSON.stringify(rec)).not.toContain('2468');
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(checkPin('2468', rec)).toBe(true);
    expect(checkPin('2469', rec)).toBe(false);
    expect(makePinRecord('2468', new Uint8Array(16).fill(8), 1000).hash).not.toBe(rec.hash);
  });
});
