// Runs with node --test (npm test). Netlify functions are plain ES modules, outside Jest.
// The Garmin function forwards only the app's exact calls, and only for a person signed in to
// the app's Firebase project. The tokens here are signed with a key made for the test.
import handler, { targetFor } from '../../netlify/functions/garmin.mjs';
import { AUTH_HEADER, forgetKeys, PROJECT_ID, verifyFirebaseToken } from '../../netlify/lib/auth.mjs';
import assert from 'node:assert';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const base = 'https://x.netlify.app/api/garmin';
const NOW = Date.UTC(2026, 10, 14, 8, 0, 0);
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims = {}, { key = privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const t = Math.floor(NOW / 1000);
  const body = `${b64({ alg, kid, typ: 'JWT' })}.${b64({ aud: PROJECT_ID, iss: `https://securetoken.google.com/${PROJECT_ID}`, sub: 'user-1', iat: t - 60, auth_time: t - 600, exp: t + 3000, ...claims })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key).toString('base64url')}`;
}
let keyFetches = 0;
const keys = async () => { keyFetches++; return { ok: true, json: async () => ({ keys: [jwk] }) }; };
const auth = { doFetch: keys, now: NOW };
const garmin = (seen) => async (url, init) => { seen.push({ url, init }); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); };
const call = (path, { method = 'GET', headers = {}, signedIn = true, ip = '203.0.113.5' } = {}) =>
  new Request(base + path, { method, headers: { 'x-nf-client-connection-ip': ip, ...(signedIn ? { [AUTH_HEADER]: token() } : {}), ...headers } });

test('only the app\'s exact calls have a target', () => {
  const g = 'https://personal.connectapi.garmin.com';
  assert.equal(targetFor('POST', base + '/personalapitoken-service/personal-api/personal-api-key/token'), g + '/personalapitoken-service/personal-api/personal-api-key/token');
  assert.equal(targetFor('GET', base + '/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-10-24&endDate=2026-10-31'), g + '/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-10-24&endDate=2026-10-31');
  assert.equal(targetFor('GET', base + '/usersummary-service/stats/stress/daily/2026-10-24/2026-10-31'), g + '/usersummary-service/stats/stress/daily/2026-10-24/2026-10-31');
  assert.equal(targetFor('GET', base + '/wellness-service/wellness/bodyBattery/reports/daily?startDate=2026-10-24&endDate=2026-10-31'), g + '/wellness-service/wellness/bodyBattery/reports/daily?startDate=2026-10-24&endDate=2026-10-31');
  assert.equal(targetFor('GET', base + '/wellness-service/wellness/dailyHeartRate?date=2026-11-13'), g + '/wellness-service/wellness/dailyHeartRate?date=2026-11-13');
  // Not on the list, the wrong method, a longer path, or a way out of the path.
  for (const [method, path] of [
    ['GET', '/usersummary-service/stats/steps/daily/2026-11-01/2026-11-13'],
    ['GET', '/userprofile-service/userprofile/settings'],
    ['GET', '/personalapitoken-service/personal-api/personal-api-key/token'],
    ['DELETE', '/sleep-service/sleep/dailySleepSummariesByDate'],
    ['GET', '/wellness-service/wellness/dailyHeartRateEVIL/anything'],
    ['GET', '/wellness-service/wellness/dailyHeartRate/more'],
    ['GET', '/sleep-service/sleep/dailySleepSummariesByDateX'],
    ['GET', '/usersummary-service/stats/stress/daily/2026-10-24/2026-10-31/extra'],
    ['GET', '/usersummary-service/stats/stress/daily/all/time'],
    ['GET', '/usersummary-service/stats/stress/daily/../../../x'],
    ['GET', '/sleep-service/sleep/dailySleepSummariesByDate/%2e%2e/%2e%2e/userprofile-service/x'],
  ]) assert.equal(targetFor(method, base + path), null, `${method} ${path}`);
});

test('a signed-in call is forwarded with Garmin\'s own authorization and nothing else', async () => {
  forgetKeys();
  const seen = [];
  const res = await handler(call('/usersummary-service/stats/stress/daily/2026-10-24/2026-10-31', { headers: { authorization: 'Bearer t', cookie: 'secret=1' } }), {}, garmin(seen), auth);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '[]');
  assert.equal(seen[0].init.headers.authorization, 'Bearer t');
  assert.equal(seen[0].init.headers.cookie, undefined);
  // The sign-in is checked here and never passed on to Garmin.
  assert.equal(seen[0].init.headers[AUTH_HEADER], undefined);
});

test('without a valid sign-in nothing is forwarded', async () => {
  forgetKeys();
  const never = async () => { throw new Error('should not fetch'); };
  const path = '/sleep-service/sleep/dailySleepSummariesByDate';
  const withToken = (t) => new Request(base + path, { headers: { [AUTH_HEADER]: t, authorization: 'Bearer t' } });
  const t = Math.floor(NOW / 1000);
  const bad = {
    'no token': call(path, { signedIn: false }),
    'not a token': withToken('abc'),
    'signed with another key': withToken(token({}, { key: other.privateKey })),
    'unknown key id': withToken(token({}, { kid: 'k9' })),
    'another project': withToken(token({ aud: 'some-other-project', iss: 'https://securetoken.google.com/some-other-project' })),
    'wrong issuer': withToken(token({ iss: 'https://example.com/issuer' })),
    'expired': withToken(token({ exp: t - 10 })),
    'issued in the future': withToken(token({ iat: t + 3600 })),
    'no subject': withToken(token({ sub: '' })),
    'unsigned (alg none)': withToken(`${b64({ alg: 'none', kid: 'k1' })}.${b64({ aud: PROJECT_ID, iss: `https://securetoken.google.com/${PROJECT_ID}`, sub: 'u', iat: t, exp: t + 100 })}.`),
    'claims changed after signing': withToken((() => { const [h, , s] = token().split('.'); return `${h}.${b64({ aud: PROJECT_ID, iss: `https://securetoken.google.com/${PROJECT_ID}`, sub: 'someone-else', iat: t - 60, exp: t + 3000 })}.${s}`; })()),
  };
  for (const [name, req] of Object.entries(bad)) { const r = await handler(req, {}, never, auth); assert.equal(r.status, 401, name); assert.equal(await r.text(), 'dagsljus-sign-in-required', name); }
});

test('a path off the list is refused before anything else, and Garmin being down is 502', async () => {
  forgetKeys();
  const blocked = await handler(call('/x'), {}, async () => { throw new Error('should not fetch'); }, auth);
  assert.equal(blocked.status, 404);
  const down = await handler(call('/sleep-service/sleep/dailySleepSummariesByDate'), {}, async () => { throw new Error('net'); }, auth);
  assert.equal(down.status, 502);
});

test('one person gets a limited number of calls a minute, whatever address they come from', async () => {
  forgetKeys();
  const seen = [];
  let last;
  for (let i = 0; i < 70; i++) last = await handler(new Request(base + '/wellness-service/wellness/dailyHeartRate?date=2026-11-13', { headers: { [AUTH_HEADER]: token({ sub: 'user-many' }), 'x-nf-client-connection-ip': `198.51.100.${i}` } }), {}, garmin(seen), auth);
  assert.equal(last.status, 429);
  assert.equal(seen.length, 60);
});

test('Google\'s keys are fetched once and kept', async () => {
  forgetKeys();
  keyFetches = 0;
  for (let i = 0; i < 3; i++) assert.equal(await verifyFirebaseToken(token({ sub: `u${i}` }), auth), `u${i}`);
  assert.equal(keyFetches, 1);
});

test('the function checks against the same Firebase project as the web app', () => {
  const src = readFileSync(new URL('../../src/cloud/projectConfig.ts', import.meta.url), 'utf8');
  assert.equal(/projectId:\s*"([^"]+)"/.exec(src)?.[1], PROJECT_ID);
  const web = readFileSync(new URL('../../src/platform/endpoints.web.ts', import.meta.url), 'utf8');
  assert.ok(web.includes(`AUTH_HEADER = '${AUTH_HEADER}'`));
});
