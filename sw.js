// Bump CACHE and APP_VERSION (js/config.js) together on every deploy; tests/version.test.mjs checks they match.
const CACHE = 'pulse-v28';

const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/config.js', 'js/db.js', 'js/ui.js', 'js/slots.js', 'js/overlay.js', 'js/push.js', 'js/ranges.js', 'js/keypad.js', 'js/settings.js', 'js/voice.js',
  'js/icons.js', 'js/today.js', 'js/tasks.js', 'js/meds.js', 'js/stats.js', 'js/dashboard.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];
// Libraries and fonts: kept after first use so the app opens with no network.
const CDN = ['cdn.jsdelivr.net'];
// Fetched at install (best effort), so the first Summary open and the first offline start already have them.
const LIBS = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
    await Promise.all(LIBS.map(u => c.add(u).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // App shell: cache first. Navigations always get index.html.
    const key = req.mode === 'navigate' ? 'index.html' : req;
    e.respondWith(caches.match(key, { ignoreSearch: true }).then(hit => hit || fetch(req)));
  } else if (CDN.includes(url.hostname)) {
    // Stale-while-revalidate.
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      // Fonts load no-cors, so their responses are opaque (ok = false) but still worth keeping.
      const fresh = fetch(req).then(res => ((res.ok || res.type === 'opaque') && c.put(req, res.clone()), res)).catch(() => hit);
      return hit || fresh;
    }));
  }
  // Supabase API: network only. Writes that fail offline go to the app's queue (js/db.js).
});

// First run: the page loaded its libraries before this worker existed, so it sends their URLs to keep.
self.addEventListener('message', e => {
  if (e.data?.cache) e.waitUntil(caches.open(CACHE).then(c => c.addAll(e.data.cache)).catch(() => {}));
});

self.addEventListener('push', e => {
  const d = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(d.title || 'Pulse', {
    body: d.body || '',
    tag: d.tag,
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list =>
    list.length ? list[0].focus() : self.clients.openWindow('./')));
});
