const VERSION = '__APP_VERSION__';
const PREFIX = `conto-shell:${new URL(self.registration.scope).pathname}:`;
const CACHE = PREFIX + VERSION;
const ASSETS = ['index.html', 'app.css', 'app.js', 'model.js', 'storage.js', 'pwa.js', 'cloud.js', 'cloud-config.js', 'cloud-client.js', 'sync-engine.js', 'sync-merge.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'manrope-400.woff2', 'manrope-500.woff2', 'manrope-600.woff2', 'manrope-700.woff2'];
ASSETS.push('monthly-ui.js', 'ledger.js', 'accounts-ui.js', 'accounts.css');
ASSETS.push('auth-ui.js', 'auth.css', 'goals.css', 'notifications.css', 'privacy.css');
ASSETS.push('flowly-icon.svg', 'flowly-icon-180.png', 'flowly-icon-192.png', 'flowly-icon-512.png');
const urls = ASSETS.map(asset => new URL(asset, self.registration.scope).href);
self.addEventListener('install', event => {
  // Activate only after the entire new app is cached. Legacy clients may never
  // show an update button, so keeping this worker waiting strands them on v2.
  // Activation itself does not reload pages or touch financial data.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    // Only the explicit repair link authorizes a navigation. Other open pages
    // keep their forms and drafts until the user chooses to reload them.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const base = new URL(self.registration.scope);
    for (const client of clients) {
      const url = new URL(client.url);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.searchParams.get('aggiorna') !== '1') continue;
      const destination = new URL('./', base); destination.hash = 'panoramica';
      // Do not await navigation from the activation event: its fetch may
      // itself wait for activation, especially on WebKit.
      client.navigate(destination.href).catch(() => {});
    }
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url), base = new URL(self.registration.scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(new URL('index.html', base).href)) || fetch(event.request)));
  } else if (urls.includes(url.origin + url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request)));
  }
});
