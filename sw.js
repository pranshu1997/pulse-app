// Replaces this app's old service worker (it would keep serving the old cached app). Clears its caches,
// removes itself, and sends open windows to RKB. Browsers fetch sw.js at the same URL, so it reaches installed phones.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  await Promise.all((await caches.keys()).map(k => caches.delete(k)));
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) {
    const u = new URL(c.url);
    c.navigate('/rkb-app/health/' + u.pathname.replace(/^\/pulse-app\/?/, '') + u.search + u.hash);
  }
})()));
