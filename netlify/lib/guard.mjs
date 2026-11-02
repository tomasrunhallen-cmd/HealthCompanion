// Shared by the two functions: only the app's own pages may call them from a browser, and one
// address gets a limited number of calls a minute. The count lives in the function instance's
// memory only; nothing is stored or logged.

const WINDOW_MS = 60_000;

export function createLimiter(max) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) for (const k of hits.keys()) { hits.delete(k); if (hits.size <= 2500) break; }
    return recent.length <= max;
  };
}

/** A browser call from another site: refused. Calls without an Origin (same-origin GET, the phone) pass. */
export function foreignOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

export function clientKey(req) {
  return req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'okänd';
}

/** Null when the call may go on; otherwise the answer to give. */
export function guard(req, limiter) {
  if (foreignOrigin(req)) return new Response('Forbidden', { status: 403 });
  if (!limiter(clientKey(req))) return new Response('Too many requests', { status: 429, headers: { 'retry-after': '60' } });
  return null;
}
