// Forwards the web app's Garmin calls to Garmin's Personal API. Garmin does not allow
// calls straight from a browser, so the web version needs this hop; the phone app calls
// Garmin directly. Only the paths the app uses are forwarded. Nothing is logged or stored:
// the key, the token and the answers pass straight through.

import { createLimiter, guard } from '../lib/guard.mjs';

export const GARMIN = 'https://personal.connectapi.garmin.com';
// A sync is at most four calls; 60 a minute leaves room for retries.
const limiter = createLimiter(60);

const ALLOWED = [
  { method: 'POST', prefix: '/personalapitoken-service/personal-api/personal-api-key/token' },
  { method: 'GET', prefix: '/sleep-service/sleep/dailySleepSummariesByDate' },
  { method: 'GET', prefix: '/usersummary-service/stats/stress/daily/' },
  { method: 'GET', prefix: '/wellness-service/wellness/bodyBattery/reports/daily' },
];

export function targetFor(method, url) {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/api\/garmin/, '');
  if (path.includes('..') || !ALLOWED.some((a) => a.method === method && path.startsWith(a.prefix))) return null;
  return GARMIN + path + u.search;
}

export default async (req, _context, doFetch = fetch) => {
  const refused = guard(req, limiter);
  if (refused) return refused;
  const target = targetFor(req.method, req.url);
  if (!target) return new Response('Not found', { status: 404 });
  const headers = { accept: req.headers.get('accept') ?? '*/*' };
  const auth = req.headers.get('authorization');
  if (auth) headers.authorization = auth;
  let res;
  try {
    res = await doFetch(target, { method: req.method, headers });
  } catch {
    return new Response('Garmin could not be reached', { status: 502 });
  }
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'text/plain',
      'cache-control': 'no-store',
    },
  });
};

export const config = { path: '/api/garmin/*' };
