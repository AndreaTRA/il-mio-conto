import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudClient, validateCloudConfig } from '../public/cloud-client.js';
const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_testing_key_not_real' };
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'owner@example.test' };
function harness(fetcher) {
  const meta = new Map(), requests = [];
  const client = new CloudClient(config, { readMeta: async key => meta.get(key), writeMeta: async (key, value) => meta.set(key, value), now: () => 1000000,
    fetcher: async (url, options) => { requests.push({ url, options }); return fetcher(url, options); } });
  return { client, meta, requests };
}
const tokenResponse = (token = 'access-one') => ({ access_token: token, refresh_token: 'refresh-one', expires_in: 3600, user });
test('the browser fetch function retains its native global receiver', async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=function(){ assert.equal(this,globalThis); return Promise.resolve(Response.json(tokenResponse())); };
    const meta=new Map();
    const client=new CloudClient(config,{readMeta:async k=>meta.get(k),writeMeta:async(k,v)=>meta.set(k,v)});
    await client.signIn('owner','test-password');
    assert.equal((await client.session()).user.id,user.id);
  } finally {globalThis.fetch=original;}
});
test('only HTTPS Supabase public configuration is accepted', () => {
  assert.equal(validateCloudConfig({ url: '', publishableKey: '' }), null);
  assert.equal(validateCloudConfig(config).url, config.url);
  for (const url of ['http://example.supabase.co', 'https://elsewhere.test', 'https://example.supabase.co/path', 'https://example.supabase.co?x=1']) assert.throws(() => validateCloudConfig({ ...config, url }));
  assert.throws(() => validateCloudConfig({ ...config, publishableKey: 'sb_secret_do_not_publish' }));
  const serviceJwt = 'x.' + btoa(JSON.stringify({ role: 'service_role' })) + '.x';
  assert.throws(() => validateCloudConfig({ ...config, publishableKey: serviceJwt }));
});
test('email OTP verification persists a session and sends no credentials in URLs', async () => {
  const app = harness(async url => Response.json(url.endsWith('/verify') ? tokenResponse() : {}));
  assert.equal(await app.client.sendCode(' OWNER@EXAMPLE.TEST '), user.email);
  const session = await app.client.verifyCode(user.email, '123456');
  assert.equal(session.user.id, user.id); assert.equal(session.expiresAt, 4600000);
  assert.equal(app.requests[0].url, config.url + '/auth/v1/otp');
  assert.deepEqual(JSON.parse(app.requests[0].options.body), { email: user.email, create_user: true });
  assert.equal(app.requests[0].options.credentials, 'omit');
  assert.equal(app.requests[0].options.headers.apikey, config.publishableKey);
  assert.ok(!app.requests.some(request => request.url.includes('123456') || request.url.includes('access-one')));
});
test('concurrent expired requests share one refresh and use the new bearer token', async () => {
  let refreshes = 0;
  const app = harness(async url => { if (url.includes('/token?')) { refreshes++; return Response.json(tokenResponse('new-access')); } return Response.json(url.endsWith('/conto_my_account') ? { status: 'approved' } : []); });
  app.meta.set(app.client.sessionKey, { projectUrl: config.url, user, expiresAt: 0, accessToken: 'old-access', refreshToken: 'old-refresh' });
  await Promise.all([app.client.readSnapshot(user.id), app.client.readSnapshot(user.id)]);
  assert.equal(refreshes, 1);
  const calls = app.requests.filter(request => request.url.includes('/rest/'));
  assert.ok(calls.every(request => request.options.headers.Authorization === 'Bearer new-access'));
});
test('an account mismatch is rejected before transmitting an archive', async () => {
  const app = harness(async () => { throw Error('must not fetch'); });
  app.meta.set(app.client.sessionKey, { projectUrl: config.url, user, expiresAt: 99999999, accessToken: 'token', refreshToken: 'refresh' });
  await assert.rejects(() => app.client.writeSnapshot('different-user', 1, {}));
  assert.equal(app.requests.length, 0);
});
test('a server CAS conflict is returned without an unconditional overwrite', async () => {
  const app = harness(async () => Response.json({ status: 'conflict' }));
  app.meta.set(app.client.sessionKey, { projectUrl: config.url, user, expiresAt: 99999999, accessToken: 'token', refreshToken: 'refresh' });
  assert.deepEqual(await app.client.writeSnapshot(user.id, 4, { schemaVersion: 2 }), { conflict: true });
  assert.equal(app.requests.length, 1);
  assert.equal(JSON.parse(app.requests[0].options.body).p_expected_version, 4);
});
test('default email links are exchanged only with this project and never followed', async () => {
  const app = harness(async () => Response.json(tokenResponse()));
  const link = config.url + '/auth/v1/verify?token=' + 'a'.repeat(64) + '&type=magiclink&redirect_to=https://example.test';
  await app.client.verifyEmailLink(user.email, link);
  assert.equal(app.requests[0].url, config.url + '/auth/v1/verify');
  assert.deepEqual(JSON.parse(app.requests[0].options.body), { token_hash: 'a'.repeat(64), type: 'email' });
  assert.equal((await app.client.session()).user.email, user.email);
  await assert.rejects(() => app.client.verifyEmailLink(user.email, link.replace(config.url, 'https://attacker.test')));
  assert.equal(app.requests.length, 1);
});
test('an email link for a different user never changes the stored session', async () => {
  const app = harness(async () => Response.json(tokenResponse()));
  await assert.rejects(() => app.client.verifyEmailLink('different@example.test', config.url + '/auth/v1/verify?token=' + 'a'.repeat(64) + '&type=signup'));
  assert.equal(await app.client.session(), undefined);
});
test('a redirect is verified with Auth and requires explicit acceptance before storage', async () => {
  const app = harness(async () => Response.json(tokenResponse()));
  const candidate = await app.client.sessionFromRedirect('#access_token=untrusted&refresh_token=refresh-from-link&type=magiclink');
  assert.equal(await app.client.session(), undefined);
  assert.equal(app.requests[0].url, config.url + '/auth/v1/token?grant_type=refresh_token');
  assert.deepEqual(JSON.parse(app.requests[0].options.body), { refresh_token: 'refresh-from-link' });
  await app.client.acceptRedirectSession(candidate);
  assert.equal((await app.client.session()).accessToken, 'access-one');
});
test('expired or unrelated redirect fragments never create a session', async () => {
  const app = harness(async () => { throw Error('must not fetch'); });
  assert.equal(await app.client.sessionFromRedirect('#backup'), null);
  await assert.rejects(() => app.client.sessionFromRedirect('#error=access_denied&error_description=expired'));
  await assert.rejects(() => app.client.sessionFromRedirect('#access_token=a&refresh_token=b&type=unrelated'));
  assert.equal(app.requests.length, 0);
});
test('password sign-in uses the server alias resolver and never stores the password', async () => {
  const app = harness(async () => Response.json({ ...tokenResponse(), user: { ...user, app_metadata: { login_username: 'test-owner' } } }));
  await app.client.signIn('test-owner', 'private-test-password');
  assert.equal(app.requests[0].url, config.url + '/functions/v1/password-login');
  assert.equal(JSON.parse(app.requests[0].options.body).identifier, 'test-owner');
  assert.equal((await app.client.session()).user.username, 'test-owner');
  assert.ok(!JSON.stringify([...app.meta]).includes('private-test-password'));
});
test('a failed password attempt never overwrites an existing session', async () => {
  const app = harness(async () => Response.json({error:'Invalid credentials'}, {status:401}));
  const original = {projectUrl:config.url,user,accessToken:'existing'};
  app.meta.set(app.client.sessionKey, original);
  await assert.rejects(() => app.client.signIn('unknown','incorrect-password'));
  assert.deepEqual(await app.client.session(), original);
});
test('recovery email requests contain no password and do not change the session', async () => {
  const app = harness(async () => Response.json({ok:true}));
  await app.client.requestPasswordRecovery('test-owner');
  assert.deepEqual(JSON.parse(app.requests[0].options.body), {action:'recover',identifier:'test-owner'});
  assert.equal(await app.client.session(), undefined);
});
test('a recovery link opens only a pending recovery session and cannot sign in directly', async () => {
  const app = harness(async () => Response.json(tokenResponse()));
  const candidate = await app.client.verifyRecoveryLink(config.url + '/auth/v1/verify?token=' + 'a'.repeat(64) + '&type=recovery');
  assert.equal(candidate.recovery,true);
  assert.equal(await app.client.session(), undefined);
  await assert.rejects(() => app.client.acceptRedirectSession(candidate));
  await app.client.resetPassword(candidate,'a-new-test-password');
  assert.equal(app.requests[1].options.method,'PUT');
  assert.equal(app.requests[1].options.headers.Authorization,'Bearer access-one');
  assert.ok(!JSON.stringify([...app.meta]).includes('a-new-test-password'));
});

test('registration validates details and never stores a signup session or admin claims', async () => {
  const app = harness(async () => Response.json(tokenResponse()));
  const details = { firstName: ' Ada ', lastName: ' Rossi ', email: 'ADA@example.test', phone: '+39 333 1234567', password: 'a-long-test-password' };
  await app.client.register(details);
  assert.equal(await app.client.session(), undefined);
  const body = JSON.parse(app.requests[0].options.body);
  assert.deepEqual(body.data, { first_name: 'Ada', last_name: 'Rossi', phone: details.phone });
  assert.equal(body.email, 'ada@example.test');
  await assert.rejects(() => app.client.register({ ...details, phone: 'invalid' }));
  assert.equal(app.requests.length, 1);
});
for (const status of ['pending', 'rejected', 'blocked']) test(`${status} accounts cannot start a snapshot download`, async () => {
  const app = harness(async () => Response.json({ status }));
  app.meta.set(app.client.sessionKey, { projectUrl: config.url, user, expiresAt: 99999999, accessToken: 'token', refreshToken: 'refresh' });
  await assert.rejects(() => app.client.readSnapshot(user.id), error => error.authRequired === true);
  assert.equal(app.requests.length, 1);
  assert.ok(app.requests[0].url.endsWith('/conto_my_account'));
});
