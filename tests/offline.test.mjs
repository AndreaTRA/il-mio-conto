import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function worker() {
  const handlers = new Map(), stores = new Map(); let claimed = false, skipped = false;
  const scope = 'https://example.github.io/il-mio-conto/';
  const key = (request, ignoreSearch = false) => { const url = new URL(typeof request === 'string' ? request : request.url); if (ignoreSearch) url.search = ''; return url.href; };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return { async addAll(urls) { for (const request of urls) { const url = key(request); data.set(url, new Response('cached:' + url)); } }, async match(request, options = {}) { return data.get(key(request, options.ignoreSearch))?.clone(); } };
    },
    async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); }
  };
  const self = { registration: { scope }, addEventListener(name, fn) { handlers.set(name, fn); }, clients: { async claim() { claimed = true; } }, skipWaiting() { skipped = true; } };
  vm.runInNewContext((await fs.readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8')).replace('__APP_VERSION__', 'test-version'), { self, caches, URL, Request, fetch: async () => { throw new Error('offline'); } });
  return { scope, stores, handlers, caches, get claimed() { return claimed; }, get skipped() { return skipped; } };
}
test('service worker caches the app at a GitHub project subpath and opens offline', async () => {
  const app = await worker(); let installation;
  app.handlers.get('install')({ waitUntil(promise) { installation = promise; } }); await installation;
  const store = [...app.stores.values()][0];
  for (const asset of ['index.html', 'app.js', 'model.js', 'storage.js', 'pwa.js', 'app.css', 'manifest.webmanifest']) assert.ok(store.has(app.scope + asset));
  assert.ok(![...store.keys()].some(url => /backup|seed|api|saldi-iniziali/.test(url)));
  let navigation;
  app.handlers.get('fetch')({ request: { method: 'GET', mode: 'navigate', url: app.scope + '?anything=1' }, respondWith(promise) { navigation = promise; } });
  assert.equal(await (await navigation).text(), 'cached:' + app.scope + 'index.html');
  let module;
  app.handlers.get('fetch')({ request: new Request(app.scope + 'model.js?v=1'), respondWith(promise) { module = promise; } });
  assert.equal(await (await module).text(), 'cached:' + app.scope + 'model.js');
});
test('activation deletes only old app-shell caches within this exact app scope', async () => {
  const app = await worker(); let install, activation;
  app.handlers.get('install')({ waitUntil(promise) { install = promise; } }); await install;
  await app.caches.open('conto-shell:/il-mio-conto/:old');
  await app.caches.open('conto-shell:/another-app/:old');
  await app.caches.open('private-user-data');
  app.handlers.get('activate')({ waitUntil(promise) { activation = promise; } }); await activation;
  assert.equal(app.stores.has('conto-shell:/il-mio-conto/:old'), false);
  assert.equal(app.stores.has('conto-shell:/another-app/:old'), true);
  assert.equal(app.stores.has('private-user-data'), true);
  assert.equal(app.claimed, true);
  assert.equal(app.skipped, false);
  app.handlers.get('message')({ data: { type: 'ACTIVATE_UPDATE' } });
  assert.equal(app.skipped, true);
});
test('external requests, personal backups and mutations are not cached or intercepted', async () => {
  const app = await worker();
  for (const request of [new Request('https://other.example/data'), new Request(app.scope + 'private-backup.json'), new Request(app.scope + 'data', { method: 'POST' })]) {
    let intercepted = false;
    app.handlers.get('fetch')({ request, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, request.url);
  }
});
test('every precached asset exists and all app imports stay within the site', async () => {
  const app = await worker(); let installation;
  app.handlers.get('install')({ waitUntil(promise) { installation = promise; } }); await installation;
  const urls = [...app.stores.values()][0].keys();
  for (const url of urls) await fs.access(new URL('../public/' + url.slice(app.scope.length), import.meta.url));
  for (const name of ['app.js', 'storage.js', 'pwa.js']) {
    const text = await fs.readFile(new URL('../public/' + name, import.meta.url), 'utf8');
    for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('./'));
  }
});
