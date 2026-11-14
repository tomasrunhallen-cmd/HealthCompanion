// Forwards the web app's Garmin calls to Garmin's Personal API. Garmin does not allow
// calls straight from a browser, so the web version needs this hop; the phone app calls
// Garmin directly. Only the exact calls the app makes are forwarded, and only for a person
// signed in to the app (netlify/lib/auth.mjs). Nothing is logged or stored: the key, the token
// and the answers pass straight through.

import { AUTH_HEADER, verifyFirebaseToken } from '../lib/auth.mjs';
import { createLimiter, guard } from '../lib/guard.mjs';

export const GARMIN = 'https://personal.connectapi.garmin.com';
// A sync is four calls plus one heart-rate call per new day (at most eight); 60 a minute
// leaves room for retries. A backfill of heart rate pauses between days to stay under it.
const limiter = createLimiter(60);
const userLimiter = createLimiter(60);

// Exactly the calls the app makes: the whole path must match, not only its beginning.
const DATE = '\\d{4}-\\d{2}-\\d{2}';
const ALLOWED = [
  { method: 'POST', path: /^\/personalapitoken-service\/personal-api\/personal-api-key\/token$/ },
  { method: 'GET', path: /^\/sleep-service\/sleep\/dailySleepSummariesByDate$/ },
  { method: 'GET', path: new RegExp(`^/usersummary-service/stats/stress/daily/${DATE}/${DATE}$`) },
  { method: 'GET', path: /^\/wellness-service\/wellness\/bodyBattery\/reports\/daily$/ },
  { method: 'GET', path: /^\/wellness-service\/wellness\/dailyHeartRate$/ },
];

export function targetFor(method, url) {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/api\/garmin/, '');
  if (path.includes('..') || !ALLOWED.some((a) => a.method === method && a.path.test(path))) return null;
  return GARMIN + path + u.search;
}

/**
 * `doFetch` reaches Garmin; `auth` holds what the sign-in check needs (tests pass their own keys
 * and clock). Only a signed-in person of this app's Firebase project gets a call forwarded.
 */
export default async (req, _context, doFetch = fetch, auth = {}) => {
  const refused = guard(req, limiter);
  if (refused) return refused;
  const target = targetFor(req.method, req.url);
  if (!target) return new Response('Not found', { status: 404 });
  const uid = await verifyFirebaseToken(req.headers.get(AUTH_HEADER), auth);
  if (!uid) return new Response('Sign in to Dagsljus first', { status: 401, headers: { 'cache-control': 'no-store' } });
  if (!userLimiter(uid)) return new Response('Too many requests', { status: 429, headers: { 'retry-after': '60' } });
  const headers = { accept: req.headers.get('accept') ?? '*/*' };
  const authorization = req.headers.get('authorization');
  if (authorization) headers.authorization = authorization;
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
