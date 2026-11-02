// Passwords are checked by Supabase Auth. The privileged key stays on the server
// and is used only to resolve a server-managed username to its account email.
export function createHandler({ url, anonKey, serviceKey, fetcher = fetch, now = () => Date.now() }) {
  const attempts = new Map();
  const allowed = new Set(['https://andreatra.github.io', 'http://localhost:8791', 'http://127.0.0.1:8791']);
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      ...(allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowed.has(origin)) return reply({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    try {
      if (!url || !anonKey || !serviceKey) return reply({ error: 'Service unavailable' }, 503);
      const text = await request.text();
      if (text.length > 4096) return reply({ error: 'Invalid request' }, 400);
      const { identifier: raw, password, action } = JSON.parse(text);
      const identifier = String(raw || '').trim().toLowerCase();
      if (!['login', 'recover'].includes(action) || !identifier || identifier.length > 254 || (action === 'login' && (typeof password !== 'string' || !password || password.length > 128))) return reply({ error: 'Invalid credentials' }, 400);
      const key = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0] + ':' + identifier;
      const time = now();
      for (const [id, item] of attempts) if (time - item.start > 60000) attempts.delete(id);
      const count = attempts.get(key) || { start: time, count: 0 };
      if (++count.count > 8 || attempts.size > 2000) return reply({ error: 'Rate limited' }, 429);
      attempts.set(key, count);
      const call = async (path, options = {}, privileged = false) => fetcher(url + path, { ...options, signal: AbortSignal.timeout(10000),
        headers: { apikey: privileged ? serviceKey : anonKey, Authorization: 'Bearer ' + (privileged ? serviceKey : anonKey), 'Content-Type': 'application/json' } });
      let email = identifier.includes('@') ? identifier : null;
      if (!email && /^[a-z0-9_.-]{3,32}$/.test(identifier)) {
        const response = await call('/auth/v1/admin/users?page=1&per_page=1000', {}, true);
        if (!response.ok) return reply({ error: 'Service unavailable' }, 503);
        const users = (await response.json()).users || [];
        const matching = users.filter(user => String(user.app_metadata?.login_username || '').toLowerCase() === identifier);
        if (matching.length === 1) email = matching[0].email;
      }
      // Unknown aliases get the same Auth request and public response as an
      // incorrect password. Never disclose which account or email was found.
      email ||= 'unassigned-account@invalid.example';
      if (action === 'recover') {
        const response = await call('/auth/v1/recover?redirect_to=' + encodeURIComponent('https://andreatra.github.io/il-mio-conto/'), { method: 'POST', body: JSON.stringify({ email }) });
        if (response.status === 429) return reply({ error: 'Rate limited' }, 429);
        if (response.status >= 500) return reply({ error: 'Service unavailable' }, 503);
        return reply({ ok: true });
      }
      const response = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
      const data = await response.json();
      const errorCode = typeof data.code === 'string' ? data.code : data.error_code;
      if (response.status === 429) return reply({ error: 'Rate limited' }, 429);
      if (!response.ok) return reply({ error: 'Invalid credentials', ...(errorCode === 'email_not_confirmed' ? { code: errorCode } : {}) }, response.status >= 500 ? 503 : 401);
      return reply({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, expires_in: data.expires_in,
        user: { id: data.user.id, email: data.user.email, app_metadata: { login_username: data.user.app_metadata?.login_username || '' } } });
    } catch { return reply({ error: 'Service unavailable' }, 503); }
  };
}
