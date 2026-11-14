// Who is calling: the web app sends the signed-in person's Firebase ID token in the
// x-dagsljus-auth header, and the function checks it before anything is forwarded. The token is
// a JWT signed by Google (RS256); the keys are Google's public ones, fetched and kept for an hour.
// Nothing is stored or logged. No dependency: Web Crypto does the check.

/** The Firebase project of the web version. Must be the same as in src/cloud/projectConfig.ts (a test checks it). */
export const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'dagsljus-1d0ab';
export const AUTH_HEADER = 'x-dagsljus-auth';
const KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const KEYS_TTL_MS = 60 * 60 * 1000;
const SKEW_S = 300;

let cache = { at: 0, keys: [] };

async function googleKeys(doFetch, now) {
  if (cache.keys.length && now - cache.at < KEYS_TTL_MS) return cache.keys;
  const res = await doFetch(KEYS_URL);
  if (!res.ok) throw new Error('keys');
  const body = await res.json();
  cache = { at: now, keys: Array.isArray(body.keys) ? body.keys : [] };
  return cache.keys;
}

/** For tests: forget the fetched keys. */
export function forgetKeys() {
  cache = { at: 0, keys: [] };
}

const fromB64Url = (s) => Uint8Array.from(Buffer.from(s, 'base64url'));
const json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/**
 * The user id (uid) of a valid Firebase ID token for this project, or null. Checks the
 * signature against Google's keys, and the audience, issuer, expiry and subject.
 */
export async function verifyFirebaseToken(token, { doFetch = fetch, now = Date.now(), projectId = PROJECT_ID } = {}) {
  try {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) return null;
    const header = json(parts[0]);
    const claims = json(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) return null;
    const t = Math.floor(now / 1000);
    if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) return null;
    if (!(claims.exp > t) || !(claims.iat <= t + SKEW_S) || (claims.auth_time != null && !(claims.auth_time <= t + SKEW_S))) return null;
    const jwk = (await googleKeys(doFetch, now)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return ok ? claims.sub : null;
  } catch {
    return null;
  }
}
