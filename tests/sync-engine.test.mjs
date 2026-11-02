import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../public/sync-engine.js';
import { AuthenticationError } from '../public/cloud-client.js';
import { emptyState, validateState, setEntry } from '../public/model.js';
import { sameIdentity, samePayload } from '../public/sync-merge.js';
const clone = value => structuredClone(value);
const actor = { id: '00000000-0000-0000-0000-000000000001', email: 'owner@example.test' };
const url = 'https://example.supabase.co';
const put = (state, month, amount, note = '') => setEntry(state, { month, balanceCents: amount, note });
class MemoryStore {
  constructor(payload = emptyState()) { this.current = { ...validateState(payload), revision: 1, updatedAt: 'start', sync: null }; this.meta = new Map(); }
  async load() { return clone(this.current); }
  async writeMeta(key, value) { this.meta.set(key, clone(value)); }
  async bindCloud(identity) { if (this.current.sync && !sameIdentity(this.current.sync, identity)) throw Error('Account differente'); this.current.sync ||= { ...identity, base: null, remoteVersion: 0 }; return this.load(); }
  async stageCloud(payload, revision, identity, remote) {
    if (revision !== this.current.revision) { const error = Error('Local conflict'); error.current = await this.load(); throw error; }
    if (!sameIdentity(this.current.sync, identity)) throw Error('Account differente');
    const changed = !samePayload(this.current, payload); if (changed) this.previous = await this.load();
    this.current = { ...validateState(payload), revision: revision + Number(changed), sync: { ...this.current.sync, base: validateState(remote.payload || emptyState()), remoteVersion: remote.version } };
    return this.load();
  }
  async acknowledgeCloud(identity, version, payload) {
    if (!sameIdentity(this.current.sync, identity)) throw Error('Account differente');
    if (version >= this.current.sync.remoteVersion) Object.assign(this.current.sync, { remoteVersion: version, base: validateState(payload), syncedAt: 'now' });
    return this.load();
  }
  edit(month, amount, note = '') { this.current = { ...this.current, ...put(this.current, month, amount, note), revision: this.current.revision + 1 }; }
}
class Server {
  constructor() { this.payload = null; this.version = 0; this.writes = 0; }
}
function device(server, payload = emptyState()) {
  const store = new MemoryStore(payload); let user = actor, isOnline = true;
  const client = { configured: true, config: { url }, hook: null, readError: null,
    async session() { return user ? { user } : null; },
    async readSnapshot() { if (this.readError) throw this.readError; return { version: server.version, payload: clone(server.payload) }; },
    async writeSnapshot(userId, expectedVersion, next) {
      if (this.hook) { const hook = this.hook; this.hook = null; await hook(next); }
      if (expectedVersion !== server.version) return { conflict: true };
      server.payload = clone(next); server.version++; server.writes++; return { version: server.version };
    },
    async logout() { user = null; }, async forgetSession() { user = null; }
  };
  const engine = new SyncEngine({ client, store, online: () => isOnline });
  return { engine, store, client, setOnline(value) { isOnline = value; }, setUser(value) { user = value; } };
}
test('sign-in alone never uploads an unlinked local archive', async () => {
  const server = new Server(), app = device(server, put(emptyState(), '2035-01', 10000));
  await app.engine.initialize(); assert.equal(app.engine.status.phase, 'ready-to-link'); assert.equal(server.writes, 0);
  await app.engine.activate(); assert.equal(server.writes, 1); assert.equal(app.engine.status.phase, 'synced');
});
test('offline edits survive reopening and merge with independent edits on another device', async () => {
  const server = new Server(), base = put(emptyState(), '2035-01', 10000);
  const mac = device(server, base), phone = device(server);
  await mac.engine.activate(); await phone.engine.activate();
  phone.setOnline(false); phone.store.edit('2035-02', 20000);
  await phone.engine.trigger(); assert.equal(phone.engine.status.phase, 'pending');
  mac.store.edit('2035-01', 10000, 'nota Mac'); await mac.engine.trigger();
  const reopened = new SyncEngine({ client: phone.client, store: phone.store, online: () => true });
  await reopened.initialize(); await mac.engine.trigger();
  assert.equal(reopened.status.phase, 'synced');
  assert.equal(server.payload.entries[0].note, 'nota Mac');
  assert.equal(server.payload.entries[1].balanceCents, 20000);
  assert.ok(samePayload(await mac.store.load(), await phone.store.load()));
});
test('two edits to one amount stop for a choice, preserving a remote copy', async () => {
  const server = new Server(), base = put(emptyState(), '2035-01', 10000);
  const mac = device(server, base), phone = device(server);
  await mac.engine.activate(); await phone.engine.activate();
  mac.store.edit('2035-01', 11000); phone.store.edit('2035-01', 12000);
  await mac.engine.trigger(); const version = server.version;
  await phone.engine.trigger(); assert.equal(phone.engine.status.phase, 'conflict'); assert.equal(server.version, version);
  assert.equal(phone.store.meta.get('last-cloud-conflict').payload.entries[0].balanceCents, 11000);
  await phone.engine.resolve('remote');
  assert.equal(phone.engine.status.phase, 'synced'); assert.equal((await phone.store.load()).entries[0].balanceCents, 11000);
  assert.equal(phone.store.previous.entries[0].balanceCents, 12000);
});
test('a stale conflict decision is not applied to newer remote values', async () => {
  const server = new Server(), base = put(emptyState(), '2035-01', 10000);
  const mac = device(server, base), phone = device(server);
  await mac.engine.activate(); await phone.engine.activate();
  mac.store.edit('2035-01', 11000); phone.store.edit('2035-01', 12000); await mac.engine.trigger(); await phone.engine.trigger();
  mac.store.edit('2035-01', 13000); await mac.engine.trigger();
  await phone.engine.resolve('local');
  assert.equal(phone.engine.status.phase, 'conflict'); assert.equal(server.payload.entries[0].balanceCents, 13000);
});
test('local edits made during upload remain pending and are uploaded next', async () => {
  const server = new Server(), app = device(server, put(emptyState(), '2035-01', 10000));
  await app.engine.activate(); app.store.edit('2035-02', 20000);
  app.client.hook = () => app.store.edit('2035-03', 30000);
  await app.engine.trigger();
  assert.equal(app.engine.status.phase, 'synced'); assert.equal(server.payload.entries.length, 3);
  assert.equal(server.payload.entries[2].balanceCents, 30000);
});
test('server compare-and-swap conflict retries against the new baseline', async () => {
  const server = new Server(), app = device(server, put(emptyState(), '2035-01', 10000));
  await app.engine.activate(); app.store.edit('2035-02', 20000);
  app.client.hook = () => { server.payload = put(server.payload, '2035-03', 30000); server.version++; };
  await app.engine.trigger();
  assert.equal(app.engine.status.phase, 'synced'); assert.equal(server.payload.entries.length, 3);
});
test('missing remote archive or a different account never erases or uploads local data', async () => {
  const server = new Server(), app = device(server, put(emptyState(), '2035-01', 10000));
  await app.engine.activate(); const writes = server.writes;
  server.payload = null; server.version = 0; await app.engine.trigger();
  assert.equal(app.engine.status.phase, 'error'); assert.equal((await app.store.load()).entries[0].balanceCents, 10000);
  app.setUser({ id: '00000000-0000-0000-0000-000000000002', email: 'other@example.test' });
  await app.engine.trigger(); assert.equal(app.engine.status.phase, 'error'); assert.equal(server.writes, writes);
});
test('expired authentication retains unsent local changes and stops repeated refreshes', async () => {
  const server = new Server(), app = device(server, put(emptyState(), '2035-01', 10000));
  await app.engine.activate(); app.store.edit('2035-02', 20000); app.client.readError = new AuthenticationError();
  await app.engine.trigger(); assert.equal(app.engine.status.phase, 'signed-out'); assert.equal(await app.client.session(), null);
  assert.equal((await app.store.load()).entries.length, 2);
});
test('logout during an upload does not re-enable the signed-out session', async () => {
  const server = new Server(), app = device(server, put(emptyState(), '2035-01', 10000));
  await app.engine.activate(); app.store.edit('2035-02', 20000);
  let started, release;
  const inFlight = new Promise(resolve => started = resolve), finished = new Promise(resolve => release = resolve);
  app.client.hook = async () => { started(); await finished; };
  const running = app.engine.trigger(); await inFlight;
  await app.engine.logout(); release(); await running;
  assert.equal(app.engine.status.phase, 'signed-out');
  assert.equal((await app.store.load()).entries.length, 2);
});

test('automatic linking after login merges existing local snapshots and pulls them on a second device',async()=>{
 const server=new Server(),phone=device(server,put(emptyState(),'2035-01',123456)),mac=device(server);
 await phone.engine.initialize({autoLink:true});assert.equal(phone.engine.status.phase,'synced');
 await mac.engine.initialize({autoLink:true});assert.equal(mac.engine.status.phase,'synced');
 assert.equal((await mac.store.load()).entries[0].balanceCents,123456);
 mac.store.edit('2035-02',234567);await mac.engine.trigger();await phone.engine.trigger();
 assert.ok(samePayload(await phone.store.load(),await mac.store.load()));
});
test('idle sync checks do not request a financial rerender',async()=>{
 const server=new Server(),app=device(server,put(emptyState(),'2035-01',100));
 await app.engine.initialize({autoLink:true});
 const notifications=[];app.engine.onChange=state=>notifications.push(state);
 await app.engine.trigger();assert.ok(notifications.every(state=>!state.dataChanged));
});
