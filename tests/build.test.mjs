import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('publication contains only public assets and a versioned offline worker', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
  const files = await fs.readdir(path.join(root, 'dist'));
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('.nojekyll'));
  assert.ok(!files.some(name => /seed|backup|saldi-iniziali|accesso|\.env|\.private/i.test(name)));
  const worker = await fs.readFile(path.join(root, 'dist/service-worker.js'), 'utf8');
  assert.ok(!worker.includes('__APP_VERSION__'));
  assert.match(worker, /const VERSION = '[a-f0-9]{16}'/);
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
  assert.ok(!html.includes('seed.js'));
  assert.ok(!html.includes('unlock-dialog'));
  assert.ok(!html.includes('/api/'));
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './');
});
test('installing an update bypasses stale HTTP cache for every offline asset', async () => {
  const source = await fs.readFile(path.join(root, 'public/service-worker.js'), 'utf8');
  const handlers = new Map(); let requests;
  vm.runInNewContext(source, {
    URL, Request,
    self: { registration: { scope: 'https://example.com/flowly/' }, addEventListener: (name, callback) => handlers.set(name, callback) },
    caches: { open: async () => ({ addAll: async items => { requests = items; } }) }
  });
  let installation;
  handlers.get('install')({ waitUntil: promise => { installation = promise; } });
  await installation;
  assert.ok(requests.length > 20);
  assert.ok(requests.every(request => request.cache === 'reload'));
  assert.ok(requests.some(request => request.url.endsWith('/notifications.css')));
});
