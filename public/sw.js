/**
 * The service worker, kept deliberately small.
 *
 * It exists for two reasons, and neither of them is offline maps (see
 * MOBILE_APP_PLAN.md for what that would actually take):
 *
 *  1. Chrome will not offer to install a web app that has no service worker with a
 *     fetch handler, so without this there is no "Add to home screen" on Android.
 *  2. The app's own static assets — the hashed `_next/static` chunks and the
 *     MapLibre worker under `/maplibre/` — can be served straight from disk on a
 *     repeat visit, which is most of what a cold start on a phone spends its time
 *     on.
 *
 * **It caches no HTML and no data.** Every document, Server Action, RSC payload and
 * tile request goes to the network untouched, and that is the whole safety argument:
 *
 *  - The HTML is per-session and per-visitor. `page.tsx` reads the session and the
 *    region cookie, so the markup carries the signed-in user's name and their
 *    region's map. A cached copy replayed after a logout, or on a shared device,
 *    would show the wrong person's shell.
 *  - Route tiles carry visit colours. A stale one paints lines the wrong colour —
 *    a map that quietly lies about what you have ridden is worse than one that
 *    fails to load.
 *
 * What is left is content-addressed and public: `_next/static` filenames contain a
 * build hash, so a new deploy asks for new URLs and can never be served an old
 * answer. `/maplibre/` is not hashed, so it gets stale-while-revalidate — served
 * from the cache, refreshed in the background — and turns over one visit after the
 * dependency is bumped.
 */

// Bump to discard everything the previous worker stored. Only needed when the rules
// below change; hashed assets retire themselves.
const CACHE_VERSION = "v1";
const STATIC_CACHE = `railway-logbook-static-${CACHE_VERSION}`;

/** Content-addressed by build hash — safe to serve from the cache forever. */
const IMMUTABLE_PREFIX = "/_next/static/";
/**
 * Stable paths whose contents can change: refresh them behind the reader's back.
 * `/maplibre/` is the GL worker and its shared chunk, copied out of node_modules by
 * `copyMaplibreWorker` under fixed names — so a dependency bump changes the bytes
 * without changing the URL, and a plain cache-first would pin the old pair forever.
 */
const REVALIDATED_PREFIXES = ["/maplibre/"];

self.addEventListener("install", () => {
  // Nothing is precached: the asset names are build-specific and the shell is not
  // ours to store. Take over as soon as this worker is installed rather than waiting
  // for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("railway-logbook-") && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // An error page cached under an immutable URL would outlive the outage.
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    // Offline with nothing stored: reject, so the caller below fails as a plain
    // network error rather than as an unhandled rejection.
    .catch((error) => {
      if (!hit) throw error;
      return hit;
    });

  // With a hit to answer from, the response settles before the refresh does — and
  // the worker may be stopped the moment it settles. `waitUntil` is what keeps the
  // background half alive long enough to finish writing.
  if (!hit) return network;
  event.waitUntil(network);
  return hit;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Basemap and vector tiles are someone else's origin, and are the one thing this
  // worker must not start collecting.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(IMMUTABLE_PREFIX)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (REVALIDATED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
  // Everything else — documents, RSC payloads, Server Actions, Martin's tiles —
  // falls through to the network with no worker in the way.
});
