// Runs with node --test (npm test). Netlify functions are plain ES modules, outside Jest.
import handler, { targetFor } from '../../netlify/functions/garmin.mjs';
import assert from 'node:assert';
import { test } from 'node:test';
test('Garmin proxy forwards only the app\'s own calls', async () => {
const base = 'https://x.netlify.app/api/garmin';
assert.equal(targetFor('POST', base + '/personalapitoken-service/personal-api/personal-api-key/token'), 'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token');
assert.equal(targetFor('GET', base + '/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-10-24&endDate=2026-10-31'), 'https://personal.connectapi.garmin.com/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-10-24&endDate=2026-10-31');
assert.equal(targetFor('GET', base + '/userprofile-service/userprofile/settings'), null);
assert.equal(targetFor('GET', base + '/personalapitoken-service/personal-api/personal-api-key/token'), null);
assert.equal(targetFor('GET', base + '/usersummary-service/stats/stress/daily/../../../x'), null);
const seen = [];
const res = await handler(new Request(base + '/usersummary-service/stats/stress/daily/2026-10-24/2026-10-31', { headers: { authorization: 'Bearer t', cookie: 'secret=1' } }), {}, async (url, init) => { seen.push({ url, init }); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); });
assert.equal(res.status, 200); assert.equal(await res.text(), '[]');
assert.equal(seen[0].init.headers.authorization, 'Bearer t'); assert.equal(seen[0].init.headers.cookie, undefined);
const blocked = await handler(new Request(base + '/x'), {}, async () => { throw new Error('should not fetch'); });
assert.equal(blocked.status, 404);
const down = await handler(new Request(base + '/sleep-service/sleep/dailySleepSummariesByDate'), {}, async () => { throw new Error('net'); });
assert.equal(down.status, 502);
});
