/* Classroom static cache. Pose math stays on each device.
   Heavy model/WASM files are stored after the first successful download
   and retried with jitter if the host is briefly busy. */
const CACHE = "wit-static-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isHeavy(url) {
  return url.pathname.includes("/models/") || url.pathname.includes("/mediapipe/");
}

function isAppAsset(url) {
  return isHeavy(url) || url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".wasm");
}

async function networkThenCache(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

async function heavyWithRetry(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(request);
      if (res.ok) {
        await cache.put(request, res.clone());
        return res;
      }
      last = res;
      if (res.status !== 429 && res.status < 500) return res;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 350 * (i + 1) + Math.floor(Math.random() * 400)));
  }
  if (last instanceof Response) return last;
  throw last;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!isAppAsset(url)) return;
  event.respondWith(isHeavy(url) ? heavyWithRetry(req) : networkThenCache(req));
});
