// Three failures, three different things to do: the app's own sign-in has run out (sign in
// again), Garmin refused the key (make a new one), or there is no network (try later).
import { GarminClient, GarminError, SESSION_MESSAGE, SIGN_IN_REQUIRED, type GarminFetch } from '../src/garmin/client';

const reply = (status: number, body: string): GarminFetch => async () => ({ ok: status < 400, status, text: async () => body });
const kindOf = async (f: GarminFetch) => {
  try {
    await new GarminClient({ apiKey: 'k', fetch: f }).accessToken();
    return 'ok';
  } catch (e) {
    return e instanceof GarminError ? `${e.kind}: ${e.message}` : 'other';
  }
};

describe('Garmin errors say what to do', () => {
  it('an expired sign-in to Dagsljus is not a refused Garmin key', async () => {
    expect(await kindOf(reply(401, SIGN_IN_REQUIRED))).toBe(`session: ${SESSION_MESSAGE}`);
    expect(SESSION_MESSAGE).toBe('Logga in i Dagsljus igen för att hämta klockdata.');
  });

  it('a key Garmin refuses is still a key error', async () => {
    expect(await kindOf(reply(401, 'Unauthorized'))).toMatch(/^auth: Garmin godtog inte nyckeln/);
    expect(await kindOf(reply(403, ''))).toMatch(/^auth: /);
  });

  it('no network is a network error', async () => {
    expect(await kindOf(async () => { throw new Error('offline'); })).toBe('network: Ingen kontakt med Garmin. Kontrollera nätet.');
  });

  it('a data call that finds the sign-in gone stops at once, without a second try', async () => {
    let calls = 0;
    const jwt = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
    const f: GarminFetch = async (url) => {
      calls++;
      return url.includes('/token') ? { ok: true, status: 200, text: async () => jwt } : { ok: false, status: 401, text: async () => SIGN_IN_REQUIRED };
    };
    const client = new GarminClient({ apiKey: 'k', fetch: f });
    await expect(client.get('/sleep-service/sleep/dailySleepSummariesByDate')).rejects.toMatchObject({ kind: 'session' });
    expect(calls).toBe(2);
  });
});
