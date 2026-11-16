// Passwords are checked by Supabase Auth. The privileged key stays on the server
// and is used only to resolve a server-managed username to its account email.
export function createHandler({ url, anonKey, serviceKey, fetcher = fetch, now = () => Date.now() }) {
  const attempts = new Map();
  const allowed = new Set(['https://andreatra.github.io', 'http://localhost:8791', 'http://127.0.0.1:8791']);
  const limited = (key, limit, time) => {
    const count = attempts.get(key) || { start: time, count: 0 };
    if (attempts.size >= 2000 && !attempts.has(key)) return true;
    attempts.set(key, count);
    return ++count.count > limit;
  };
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      ...(allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowed.has(origin)) return reply({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    try {
      if (!url || !anonKey || !serviceKey) return reply({ error: 'Service unavailable' }, 503);
      const time = now();
      for (const [id, item] of attempts) if (time - item.start >= 60000) attempts.delete(id);
      const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128);
      if (limited('ip:' + ip, 40, time)) return reply({ error: 'Rate limited' }, 429);
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply({ error: 'Invalid request' }, 415);
      const length = request.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) return reply({ error: 'Invalid request' }, 413);
      // Bound actual bytes too: Content-Length can be absent or untrusted.
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: 'Invalid request' }, 400);
      let text = '', size = 0, timer;
      try {
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reader.cancel().catch(() => {}); reject(new Error('body timeout')); }, 10000); });
        const decoder = new TextDecoder('utf-8', { fatal: true });
        while (true) {
          const { done, value } = await Promise.race([reader.read(), deadline]);
          if (done) break;
          size += value.byteLength;
          if (size > 4096) { await reader.cancel(); return reply({ error: 'Invalid request' }, 413); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } catch { return reply({ error: 'Invalid request' }, 400); }
      finally { clearTimeout(timer); reader.releaseLock(); }
      let payload;
      try { payload = JSON.parse(text); } catch { return reply({ error: 'Invalid request' }, 400); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply({ error: 'Invalid request' }, 400);
      const { identifier: raw, password, action } = payload;
      const identifier = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!['login', 'recover'].includes(action) || !identifier || identifier.length > 254 || (action === 'login' && (typeof password !== 'string' || !password || password.length > 128))) return reply({ error: 'Invalid credentials' }, 400);
      if (limited('pair:' + ip + ':' + identifier, 8, time)) return reply({ error: 'Rate limited' }, 429);
      const call = async (path, options = {}, privileged = false) => fetcher(url + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000),
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
