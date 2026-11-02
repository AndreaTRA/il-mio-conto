export class AuthenticationError extends Error {
  constructor(message = 'Accedi di nuovo per riprendere la sincronizzazione.') { super(message); this.authRequired = true; }
}
export function validateCloudConfig(config) {
  if (!config?.url && !config?.publishableKey) return null;
  let url;
  try { url = new URL(config.url); } catch { throw new Error('Configura un URL Supabase valido.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || !['', '/'].includes(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error('Usa l’URL HTTPS del tuo progetto supabase.co.');
  const key = String(config.publishableKey || '').trim();
  if (key.startsWith('sb_secret_')) throw new Error('La chiave segreta non può essere usata nell’app. Usa la chiave pubblicabile.');
  if (key.startsWith('sb_publishable_') && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error('Controlla la chiave pubblicabile.');
  if (!key.startsWith('sb_publishable_')) {
    let role;
    try { role = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { throw new Error('Inserisci la chiave pubblicabile di Supabase.'); }
    if (role !== 'anon') throw new Error('Usa solo la chiave pubblicabile o anon, mai service_role.');
  }
  if (key.length < 20) throw new Error('La chiave pubblicabile non è completa.');
  return { url: url.origin, publishableKey: key };
}
export class CloudClient {
  constructor(config, { readMeta, writeMeta, fetcher = globalThis.fetch, now = () => Date.now(), lock = null }) {
    this.config = validateCloudConfig(config); this.readMeta = readMeta; this.writeMeta = writeMeta; this.fetcher = fetcher; this.now = now; this.lock = lock;
    this.sessionKey = this.config ? 'auth-session:' + this.config.url : ''; this.refreshing = null;
  }
  get configured() { return Boolean(this.config); }
  async session() { return this.config ? this.readMeta(this.sessionKey) : null; }
  async request(path, { method = 'GET', body, auth = false, userId, retried = false } = {}) {
    if (!this.config) throw new Error('Il collegamento a Supabase non è ancora configurato.');
    const token = auth ? await this.accessToken(userId) : null;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await this.fetcher(this.config.url + path, { method, signal: controller.signal, cache: 'no-store', credentials: 'omit',
        headers: { apikey: this.config.publishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new Error('Servizio online non raggiungibile. Le modifiche restano sul dispositivo.'); }
    finally { clearTimeout(timer); }
    if (response.status === 401 && auth && !retried) {
      await this.accessToken(userId, true); return this.request(path, { method, body, auth, userId, retried: true });
    }
    let data = null;
    try { const text = await response.text(); if (text) data = JSON.parse(text); } catch { throw new Error('Risposta online non leggibile. I dati locali sono conservati.'); }
    if (!response.ok) {
    if ([401, 403].includes(response.status) && auth) throw new AuthenticationError();
      if (response.status === 429) throw new Error('Troppi tentativi. Attendi prima di riprovare.');
      if (path.startsWith('/auth/')) throw new Error(path.includes('/verify') ? 'Codice non valido o scaduto. Richiedine uno nuovo.' : 'Accesso non riuscito. Controlla email e configurazione del servizio.');
      if ([400, 404].includes(response.status)) throw new Error('Configurazione online incompleta. Verifica lo schema Supabase della guida.');
      throw new Error('Sincronizzazione non riuscita. I dati locali sono conservati.');
    }
    return data;
  }
  async sendCode(email, redirectTo = null) {
    email = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Inserisci un indirizzo email valido.');
    const path = '/auth/v1/otp' + (redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '');
    await this.request(path, { method: 'POST', body: { email, create_user: true } }); return email;
  }
  async saveVerifiedSession(data, expectedEmail = null) {
    const session = this.normalizeSession(data);
    if (expectedEmail && session.user.email.toLowerCase() !== expectedEmail.trim().toLowerCase()) throw new Error('Il link appartiene a un’altra email. Usa quello inviato all’indirizzo indicato.');
    await this.writeMeta(this.sessionKey, session); return session;
  }
  normalizeSession(data, previous = null) {
    const user = data?.user || previous?.user;
    if (!data?.access_token || !data.refresh_token || !user?.id || !user?.email) throw new AuthenticationError('Il servizio non ha restituito un accesso valido.');
    return { accessToken: data.access_token, refreshToken: data.refresh_token,
      expiresAt: data.expires_at ? Number(data.expires_at) * 1000 : this.now() + Number(data.expires_in || 3600) * 1000,
      user: { id: user.id, email: user.email }, projectUrl: this.config.url };
  }
  async verifyCode(email, code) {
    if (!/^\d{6,10}$/.test(String(code).trim())) throw new Error('Inserisci il codice numerico ricevuto via email.');
    const data = await this.request('/auth/v1/verify', { method: 'POST', body: { email: String(email).trim().toLowerCase(), token: String(code).trim(), type: 'email' } });
    return this.saveVerifiedSession(data, email);
  }
  async verifyEmailLink(email, link) {
    email = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Indica prima la stessa email a cui hai richiesto l’accesso.');
    let url;
    try { url = new URL(String(link).trim()); } catch { throw new Error('Incolla il link completo ricevuto via email.'); }
    if (url.origin !== this.config?.url || url.pathname !== '/auth/v1/verify' || url.username || url.password || url.hash || url.searchParams.getAll('token').length !== 1 || !/^[A-Za-z0-9_-]{20,200}$/.test(url.searchParams.get('token') || '') || !['signup', 'magiclink', 'email'].includes(url.searchParams.get('type'))) throw new Error('Il link non è un accesso valido per questo progetto Supabase.');
    const data = await this.request('/auth/v1/verify', { method: 'POST', body: { token_hash: url.searchParams.get('token'), type: 'email' } });
    return this.saveVerifiedSession(data, email);
  }
  async sessionFromRedirect(fragment) {
    const params = new URLSearchParams(fragment.replace(/^#/, ''));
    if (params.has('error') || params.has('error_description')) throw new Error('Il link di accesso non è più valido. Richiedi una nuova email.');
    if (!params.has('access_token') && !params.has('refresh_token')) return null;
    if (params.has('type') && !['signup', 'magiclink', 'email'].includes(params.get('type'))) throw new Error('Usa il link dell’email di accesso, non quello di recupero password.');
    if (params.getAll('refresh_token').length !== 1 || !params.get('refresh_token') || !params.get('access_token')) throw new Error('Link di accesso incompleto. Richiedi una nuova email.');
    // Exchange the refresh token with Auth, rather than trusting URL claims.
    const data = await this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: params.get('refresh_token') } });
    return this.normalizeSession(data);
  }
  async acceptRedirectSession(session) {
    if (!session || session.projectUrl !== this.config.url) throw new Error('Accesso non valido per questo progetto.');
    await this.writeMeta(this.sessionKey, session);
  }
  async accessToken(expectedUser, force = false) {
    const current = await this.session();
    if (!current || current.projectUrl !== this.config.url) throw new AuthenticationError();
    if (expectedUser && current.user.id !== expectedUser) throw new Error('L’account è cambiato durante l’operazione. Nessun dato è stato inviato al nuovo account.');
    if (!force && current.expiresAt > this.now() + 60000) return current.accessToken;
    const refresh = async () => {
      const latest = await this.session();
      if (!latest) throw new AuthenticationError();
      if (expectedUser && latest.user.id !== expectedUser) throw new Error('L’account è cambiato durante l’operazione.');
      if (latest.accessToken !== current.accessToken || !force && latest.expiresAt > this.now() + 60000) return latest;
      let data;
      try { data = await this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: latest.refreshToken } }); }
      catch (error) { if (/Accesso non riuscito/.test(error.message)) throw new AuthenticationError(); throw error; }
      const updated = this.normalizeSession(data, latest); await this.writeMeta(this.sessionKey, updated); return updated;
    };
    if (!this.refreshing) {
      const run = this.lock ? () => this.lock(refresh) : refresh;
      this.refreshing = run().finally(() => { this.refreshing = null; });
    }
    const session = await this.refreshing;
    if (expectedUser && session.user.id !== expectedUser) throw new Error('L’account è cambiato durante l’operazione.');
    return session.accessToken;
  }
  async readSnapshot(userId) {
    const query = new URLSearchParams({ select: 'user_id,version,payload,updated_at', user_id: 'eq.' + userId });
    const rows = await this.request('/rest/v1/conto_snapshots?' + query, { auth: true, userId });
    if (!Array.isArray(rows)) throw new Error('Archivio online non leggibile.');
    if (!rows.length) return { version: 0, payload: null };
    const row = rows[0], version = Number(row.version);
    if (rows.length !== 1 || row.user_id !== userId || !Number.isSafeInteger(version) || version < 1) throw new Error('Archivio online non valido. Nessun dato locale è stato sostituito.');
    return { version, payload: row.payload, updatedAt: row.updated_at };
  }
  async writeSnapshot(userId, expectedVersion, payload) {
    const result = await this.request('/rest/v1/rpc/write_conto_snapshot', { method: 'POST', auth: true, userId, body: { p_expected_version: expectedVersion, p_payload: payload } });
    if (result?.status === 'conflict') return { conflict: true };
    if (result?.status !== 'ok' || !Number.isSafeInteger(Number(result.version)) || Number(result.version) <= expectedVersion) throw new Error('Conferma del salvataggio online non valida. Riprova senza eliminare i dati locali.');
    return { version: Number(result.version) };
  }
  async logout() {
    const session = await this.session();
    if (session) { try { await this.request('/auth/v1/logout?scope=local', { method: 'POST', auth: true, userId: session.user.id }); } catch { /* Local logout also works offline. */ } }
    await this.writeMeta(this.sessionKey, null);
  }
  async forgetSession() { await this.writeMeta(this.sessionKey, null); }
}
