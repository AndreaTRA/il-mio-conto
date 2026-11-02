import { cloudConfig } from './cloud-config.js';
import { CloudClient } from './cloud-client.js';
import { SyncEngine } from './sync-engine.js';
import * as Storage from './storage.js';

const scope = new URL('./', import.meta.url).pathname;
const lock = name => globalThis.navigator?.locks ? operation => navigator.locks.request(name + scope, operation) : null;
let configurationError = null, client;
try { client = new CloudClient(cloudConfig, { readMeta: Storage.readMeta, writeMeta: Storage.writeMeta, lock: lock('conto-auth:') }); }
catch (error) { configurationError = error; client = new CloudClient({ url: '', publishableKey: '' }, { readMeta: Storage.readMeta, writeMeta: Storage.writeMeta }); }
const subscribers = new Set();
export const cloud = new SyncEngine({ client, store: Storage, online: () => navigator.onLine !== false, lock: lock('conto-sync:'), onChange: status => subscribers.forEach(fn => fn(status)) });
export const onCloudChange = fn => { subscribers.add(fn); return () => subscribers.delete(fn); };
export const sendCode = email => client.sendCode(email, new URL('./', import.meta.url).href);
export const verifyCode = async (email, code) => { const session = await client.verifyCode(email, code); await cloud.initialize(); return session; };
export const verifyEmailLink = async (email, link) => { const session = await client.verifyEmailLink(email, link); await cloud.initialize(); return session; };
export const acceptRedirectSession = session => client.acceptRedirectSession(session);
export function takeRedirectSession() {
  const fragment = location.hash, params = new URLSearchParams(fragment.slice(1));
  if (!['access_token', 'refresh_token', 'error', 'error_description'].some(name => params.has(name))) return Promise.resolve(null);
  // Remove credentials before any network call, render or browser history entry.
  history.replaceState(null, '', location.pathname + location.search + '#backup');
  return client.sessionFromRedirect(fragment);
}
export const session = () => client.session();
export async function initializeCloud() {
  if (configurationError) { cloud.emit({ phase: 'not-configured', error: configurationError.message }); return; }
  await cloud.initialize();
  window.addEventListener('online', () => cloud.trigger());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloud.trigger(); });
  setInterval(() => { if (document.visibilityState === 'visible') cloud.trigger(); }, 20000);
}
