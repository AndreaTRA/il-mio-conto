import { emptyState, validateState } from './model.js';
import { sameIdentity, samePayload } from './sync-merge.js';

export class ConflictError extends Error {
  constructor(current) { super('I dati sono cambiati in un’altra finestra. Rivedi il saldo e salva di nuovo.'); this.current = current; }
}
const scope = new URL('./', import.meta.url).pathname;
const DB_NAME = `il-mio-conto:${scope}`;
const STORE = 'documents';
let opening;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(DB_NAME) : null;
const subscribers = new Set();
if (channel) channel.onmessage = () => subscribers.forEach(fn => fn());
export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

function open() {
  if (!opening) opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Questo browser non consente il salvataggio dei dati. Usa Safari o un browser aggiornato.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => reject(new Error('Chiudi le altre finestre dell’app e riprova.'));
  });
  return opening;
}
function document(raw) {
  const clean = validateState(raw);
  let sync = null;
  if (raw.sync) {
    const meta = raw.sync;
    if (typeof meta.projectUrl !== 'string' || typeof meta.userId !== 'string' || !Number.isSafeInteger(meta.remoteVersion) || meta.remoteVersion < 0) throw new Error('Collegamento online non leggibile. L’archivio non è stato sostituito.');
    sync = { projectUrl: meta.projectUrl, userId: meta.userId, remoteVersion: meta.remoteVersion, base: meta.base ? validateState(meta.base) : null, syncedAt: meta.syncedAt || null };
  }
  return { ...clean, revision: Number.isSafeInteger(raw.revision) && raw.revision > 0 ? raw.revision : 1, updatedAt: raw.updatedAt || new Date().toISOString(), sync };
}
export async function load() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite'), store = transaction.objectStore(STORE);
    const request = store.get('current'); let result;
    request.onsuccess = () => {
      try {
        if (request.result) result = document(request.result);
        else {
          let legacy;
          try { const text = localStorage.getItem('il-mio-conto.state.v1'); if (text) legacy = JSON.parse(text); } catch (error) {
            if (error instanceof SyntaxError) throw new Error('Il vecchio archivio non è leggibile. Non è stato sostituito.');
          }
          result = document(legacy || emptyState());
          store.put(result, 'current');
        }
      } catch (error) { reject(error); transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('Lettura non riuscita.'));
    transaction.onabort = () => reject(transaction.error || new Error('Archivio non modificato.'));
  });
}
/** A single read-write transaction prevents concurrent tabs from losing updates. */
export async function save(next, expectedRevision) {
  const clean = validateState(next), db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite'), store = transaction.objectStore(STORE);
    const request = store.get('current'); let updated, failure;
    request.onsuccess = () => {
      try {
        const previous = request.result ? document(request.result) : document(emptyState());
        if (previous.revision !== expectedRevision) { failure = new ConflictError(previous); transaction.abort(); return; }
        updated = { ...clean, revision: previous.revision + 1, updatedAt: new Date().toISOString(), sync: previous.sync };
        store.put(previous, 'previous'); store.put(updated, 'current');
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { channel?.postMessage('changed'); resolve(updated); };
    transaction.onerror = () => reject(failure || transaction.error || new Error('Salvataggio non riuscito. Esporta un backup e riprova.'));
    transaction.onabort = () => reject(failure || transaction.error || new Error('Salvataggio interrotto. I dati precedenti sono conservati.'));
  });
}
export async function previous() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get('previous');
    request.onsuccess = () => { try { resolve(request.result ? document(request.result) : null); } catch (error) { reject(error); } };
    request.onerror = () => reject(request.error);
  });
}
export async function rawRecovery() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get('current');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function updateCurrent(transform, expectedRevision) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite'), store = transaction.objectStore(STORE), request = store.get('current');
    let result, failure, notifyChange = false;
    request.onsuccess = () => {
      try {
        const current = document(request.result || emptyState());
        if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new ConflictError(current);
        result = transform(current);
        notifyChange = !samePayload(current, result) || !sameIdentity(current.sync, result.sync);
        if (!samePayload(current, result)) store.put(current, 'previous');
        store.put(result, 'current');
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { if (notifyChange) channel?.postMessage('changed'); resolve(result); };
    transaction.onabort = transaction.onerror = () => reject(failure || transaction.error || new Error('Aggiornamento dell’archivio non riuscito.'));
  });
}
function requireIdentity(current, identity) {
  if (!sameIdentity(current.sync, identity)) throw new Error('Questo archivio è associato a un altro account o progetto. Accedi con l’account originale.');
}
export function bindCloud(identity) {
  return updateCurrent(current => {
    if (current.sync) { requireIdentity(current, identity); return current; }
    return { ...current, sync: { ...identity, remoteVersion: 0, base: null, syncedAt: null } };
  });
}
/** Merge and shared baseline change atomically; metadata alone does not stale forms. */
export function stageCloud(payload, expectedRevision, identity, remote) {
  const clean = validateState(payload);
  return updateCurrent(current => {
    requireIdentity(current, identity);
    if (current.sync.remoteVersion > remote.version) throw new ConflictError(current);
    const changed = !samePayload(current, clean);
    return { ...clean, revision: current.revision + (changed ? 1 : 0), updatedAt: changed ? new Date().toISOString() : current.updatedAt,
      sync: { ...current.sync, remoteVersion: remote.version, base: validateState(remote.payload || emptyState()) } };
  }, expectedRevision);
}
/** Acknowledge the uploaded snapshot, retaining edits made while the request ran. */
export function acknowledgeCloud(identity, version, payload) {
  const clean = validateState(payload);
  return updateCurrent(current => {
    requireIdentity(current, identity);
    if (version < current.sync.remoteVersion) return current;
    return { ...current, sync: { ...current.sync, remoteVersion: version, base: clean, syncedAt: new Date().toISOString() } };
  });
}
export async function readMeta(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get('meta:' + key);
    request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error);
  });
}
export async function writeMeta(key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite'), store = transaction.objectStore(STORE);
    if (value === null) store.delete('meta:' + key); else store.put(value, 'meta:' + key);
    transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Impossibile salvare l’accesso.'));
  });
}
