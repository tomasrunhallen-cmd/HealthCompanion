import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, foreignOrigin, guard } from '../../netlify/lib/guard.mjs';
import garmin from '../../netlify/functions/garmin.mjs';

const req = (url, headers = {}) => new Request(url, { headers });

test('a browser call from another site is refused; same site and no origin pass', () => {
  assert.equal(foreignOrigin(req('https://dagsljus.example/api/garmin/x', { origin: 'https://evil.example' })), true);
  assert.equal(foreignOrigin(req('https://dagsljus.example/api/garmin/x', { origin: 'https://dagsljus.example' })), false);
  assert.equal(foreignOrigin(req('https://dagsljus.example/api/garmin/x')), false);
});

test('one address gets a limited number of calls a minute', () => {
  const limit = createLimiter(3);
  assert.deepEqual([1, 2, 3, 4].map(() => limit('a', 1000)), [true, true, true, false]);
  assert.equal(limit('b', 1000), true);
  assert.equal(limit('a', 62_000), true);
});

test('the Garmin hop answers 403 to another site and 429 when called too often', async () => {
  const other = await garmin(req('https://d.example/api/garmin/sleep-service/sleep/dailySleepSummariesByDate', { origin: 'https://evil.example' }), {}, async () => new Response('{}'));
  assert.equal(other.status, 403);
  const limit = createLimiter(1);
  const r = req('https://d.example/x', { 'x-nf-client-connection-ip': '1.2.3.4' });
  assert.equal(guard(r, limit), null);
  assert.equal(guard(r, limit).status, 429);
});
