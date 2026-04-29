/**
 * Service Worker for HealthCompanion PWA.
 *
 * Strategy:
 * - App shell (JS/CSS/HTML): Cache-first with network fallback
 * - API calls (/api/*): Network-first — NEVER cached (sensitive health data)
 * - Offline queue: When a PATCH /api/diary/* fails due to network, queue it
 *   in IndexedDB and replay when back online
 */

const CACHE_NAME = "healthcompanion-v1";
const OFFLINE_QUEUE_DB = "hc-offline-queue";

// App shell files to pre-cache on install
const PRECACHE_URLS = ["/", "/diary", "/dashboard", "/analysis", "/settings", "/offline.html"];

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS.filter(Boolean))).then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — health data stays out of the cache
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(async (err) => {
        // For diary PATCH/PUT: queue offline if network is down
        if (
          event.request.method === "PATCH" || event.request.method === "PUT"
        ) {
          if (url.pathname.startsWith("/api/diary/")) {
            await queueOfflineRequest(event.request.clone());
            return new Response(
              JSON.stringify({ error: "offline", queued: true }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            );
          }
        }
        throw err;
      })
    );
    return;
  }

  // App shell: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match("/offline.html"));
    })
  );
});

// ── Sync: replay offline queue when back online ───────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === "replay-offline-queue") {
    event.waitUntil(replayOfflineQueue());
  }
});

// ── Offline queue helpers (IndexedDB) ─────────────────────────────────────────

async function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_QUEUE_DB, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore("requests", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueOfflineRequest(request) {
  const db = await openQueueDB();
  const body = await request.text();
  const tx = db.transaction("requests", "readwrite");
  tx.objectStore("requests").add({
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    timestamp: Date.now(),
  });
}

async function replayOfflineQueue() {
  const db = await openQueueDB();
  const tx = db.transaction("requests", "readwrite");
  const store = tx.objectStore("requests");
  const all = await new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
  });
  for (const item of all) {
    try {
      await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      });
      store.delete(item.id);
    } catch {
      // Will retry on next sync
    }
  }
}
