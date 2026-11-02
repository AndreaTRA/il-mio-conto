import { emptyState, validateState } from './model.js';
import { samePayload, sameIdentity, mergeArchives, conflictFingerprint } from './sync-merge.js';

/** Transport and storage are injected so offline/concurrency cases can be tested. */
export class SyncEngine {
  constructor({ client, store, online = () => true, onChange = () => {}, lock = null }) {
    this.client = client; this.store = store; this.online = online; this.onChange = onChange; this.lock = lock;
    this.status = { phase: client.configured ? 'signed-out' : 'not-configured', email: null, error: '', conflict: null };
    this.running = null;
    this.generation = 0;
  }
  emit(values) { this.status = { ...this.status, dataChanged: false, ...values }; this.onChange(this.status); }
  async identity() {
    const session = await this.client.session();
    return session ? { projectUrl: this.client.config.url, userId: session.user.id, email: session.user.email } : null;
  }
  async initialize({ autoLink = false } = {}) {
    if (!this.client.configured) return this.emit({ phase: 'not-configured' });
    const identity = await this.identity();
    if (!identity) return this.emit({ phase: 'signed-out', email: null });
    const local = await this.store.load();
    if (!local.sync) return autoLink ? this.activate() : this.emit({ phase: 'ready-to-link', email: identity.email });
    if (!sameIdentity(local.sync, identity)) return this.emit({ phase: 'error', email: identity.email, error: 'Questo archivio è associato a un altro account. Accedi con l’account originale.' });
    await this.trigger();
  }
  async activate() {
    const identity = await this.identity();
    if (!identity) throw new Error('Accedi prima con il tuo account.');
    await this.store.bindCloud(identity); this.emit({ phase: 'pending', email: identity.email, error: '', conflict: null });
    return this.trigger();
  }
  trigger(resolution = null) {
    if (!this.client.configured || this.running) return this.running || Promise.resolve();
    const generation = this.generation;
    const run = () => this.cycle(resolution, generation);
    this.running = Promise.resolve().then(() => this.lock ? this.lock(run) : run()).catch(async error => {
      if (generation !== this.generation) return;
      if (error.authRequired) await this.client.forgetSession?.();
      this.emit({ phase: error.authRequired ? 'signed-out' : this.online() ? 'error' : 'pending', error: error.message });
    }).finally(() => { this.running = null; });
    return this.running;
  }
  async cycle(resolution, generation) {
    const active = () => generation === this.generation;
    const identity = await this.identity();
    if (!active()) return;
    if (!identity) return this.emit({ phase: 'signed-out', email: null, error: '' });
    let current = await this.store.load();
    if (!current.sync) return this.emit({ phase: 'ready-to-link', email: identity.email });
    if (!sameIdentity(current.sync, identity)) throw new Error('L’account aperto non corrisponde all’archivio del dispositivo.');
    if (!this.online()) return this.emit({ phase: 'pending', email: identity.email, error: '' });
    this.emit({ phase: 'syncing', email: identity.email, error: '', conflict: null });
    let dataChanged = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      current = await this.store.load();
      if (!sameIdentity(current.sync, identity)) throw new Error('Il collegamento dell’account è cambiato.');
      const remote = await this.client.readSnapshot(identity.userId);
      if (!active()) return;
      if (remote.payload) remote.payload = validateState(remote.payload);
      if (!remote.payload && current.sync.remoteVersion > 0) throw new Error('L’archivio online non è più disponibile. La copia locale è conservata: verifica il progetto prima di proseguire.');
      const onlinePayload = remote.payload || emptyState();
      const fingerprint = conflictFingerprint(current, onlinePayload, remote.version);
      const preference = resolution?.fingerprint === fingerprint ? resolution.preference : null;
      const merge = mergeArchives(current.sync.base, current, onlinePayload, preference);
      if (merge.conflicts.length && !preference) {
        const conflict = { fingerprint, fields: merge.conflicts, local: validateState(current), remote: onlinePayload };
        await this.store.writeMeta('last-cloud-conflict', { payload: onlinePayload, savedAt: new Date().toISOString() });
        return this.emit({ phase: 'conflict', error: resolution ? 'I dati sono cambiati. Rivedi i valori prima di scegliere.' : '', conflict });
      }
      let staged;
      try { staged = await this.store.stageCloud(merge.payload, current.revision, identity, remote); }
      catch (error) { if (error.current) continue; throw error; }
      if (!active()) return;
      if (!samePayload(staged, current)) { dataChanged = true; this.onChange({ ...this.status, dataChanged: true }); }
      if (samePayload(staged, onlinePayload) && remote.version > 0) {
        await this.store.acknowledgeCloud(identity, remote.version, onlinePayload);
      } else {
        const sent = validateState(staged);
        const written = await this.client.writeSnapshot(identity.userId, remote.version, sent);
        if (!active()) return;
        if (written.conflict) { resolution = null; continue; }
        await this.store.acknowledgeCloud(identity, written.version, sent);
      }
      const latest = await this.store.load();
      if (!active()) return;
      if (samePayload(latest, latest.sync.base)) return this.emit({ phase: 'synced', error: '', conflict: null, syncedAt: latest.sync.syncedAt, dataChanged });
      resolution = null;
    }
    this.emit({ phase: 'pending', error: '', conflict: null });
  }
  resolve(preference) {
    if (!['local', 'remote'].includes(preference) || !this.status.conflict) return Promise.resolve();
    return this.trigger({ preference, fingerprint: this.status.conflict.fingerprint });
  }
  async logout() {
    this.generation++;
    await this.client.logout(); this.emit({ phase: 'signed-out', email: null, error: '', conflict: null });
  }
}
