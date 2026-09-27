/*
 * StudyForge service worker.
 *
 * Registered only from a production build (see `src/lib/pwa.ts`), because a
 * caching worker on the dev server serves a bundle that no longer exists.
 *
 * The rule is one-directional: same-origin GETs that are content-hashed or
 * static are served from cache first, everything that carries meaning — the
 * HTML shell, any request to another origin such as the Supabase or canister
 * endpoint — goes to the network. A worker that caches an API reply pins one
 * account's data to a device, which is both a correctness bug and a privacy
 * one, so nothing cross-origin is ever written to a cache here.
 */

const VERSION = "studyforge-v2";
const STATIC = `${VERSION}-static`;
const SHELL = `${VERSION}-shell`;
const MAX_STATIC_ENTRIES = 120;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !name.startsWith(VERSION))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Only our own hashed build output and public assets. */
function isStaticAsset(url, request) {
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return false;
  }
  if (url.pathname.endsWith(".html")) return false;
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/public/") ||
    /\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico|gif)$/.test(url.pathname)
  );
}

async function trimCache(name, maxEntries) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await cache.delete(keys[0]);
}

async function staticResponse(url, request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).then(() =>
        trimCache(STATIC, MAX_STATIC_ENTRIES),
      );
    }
    return response;
  } catch (cause) {
    // An asset that was never fetched cannot be served offline; the caller
    // shows whatever it shows when a request fails.
    throw cause;
  }
}

async function shellResponse(request) {
  const network = await fetch(request).catch(() => null);
  if (network && network.ok) {
    const cache = await caches.open(SHELL);
    cache.put(request, network.clone()).then(() => trimCache(SHELL, 12));
    return network;
  }
  if (network) return network;
  const cache = await caches.open(SHELL);
  const cached =
    (await cache.match(request)) ||
    (await cache.match("/")) ||
    (await cache.match("index.html"));
  if (cached) return cached;
  return new Response("Offline", {
    status: 503,
    statusText: "Offline",
    headers: { "content-type": "text/plain" },
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (request.mode === "navigate") {
    event.respondWith(shellResponse(request));
    return;
  }
  if (isStaticAsset(url, request)) {
    event.respondWith(staticResponse(url, request));
  }
});
