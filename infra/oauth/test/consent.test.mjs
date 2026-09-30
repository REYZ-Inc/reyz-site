// ネットワーク不要の自己テスト（node --test infra/oauth/test）。Google の token / revoke endpoint は fetch の差し替えで再現する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authUrl, decodeIdToken, verifyIdentity, exchange, revoke, TOKEN_URL, REVOKE_URL, SCOPES } from '../consent.mjs';

const b64url = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = (claims) => `${b64url('{"alg":"RS256","kid":"x"}')}.${b64url(JSON.stringify(claims))}.sig`;
const CLIENT = 'cid.apps.googleusercontent.com', SENDER = 'no-reply@reyz.inc';
const now = Date.UTC(2026, 8, 30, 3, 0, 0);
const claimsFor = (email, extra = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(now / 1000) + 3600, email, email_verified: true, hd: 'reyz.inc', ...extra });

function fakeFetch({ token = {}, revokeStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, body: new URLSearchParams(init.body || '') });
    if (url === TOKEN_URL) return Response.json(token.body || { error: 'invalid_grant' }, { status: token.status || (token.body ? 200 : 400) });
    if (url === REVOKE_URL) return revokeStatus === 200 ? new Response('{}', { status: 200 }) : Response.json({ error: 'invalid_token' }, { status: revokeStatus });
    return new Response('unexpected ' + url, { status: 500 });
  };
  f.calls = calls; return f;
}
const deps = f => ({ fetch: f, now: () => now });
const okToken = (email = SENDER, extra = {}) => ({ body: { access_token: 'at', refresh_token: 'rt-new', expires_in: 3599, scope: 'openid https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email', id_token: idToken(claimsFor(email, extra)) } });

test('authUrl: 送信専用ユーザーを固定（login_hint / hd）、オフライン・同意必須、ID トークン用の scope を含む', () => {
  const u = new URL(authUrl({ clientId: CLIENT, sender: SENDER, state: 'abc' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = u.searchParams;
  assert.equal(q.get('client_id'), CLIENT); assert.equal(q.get('redirect_uri'), 'https://reyz.inc/oauth/callback.html');
  assert.equal(q.get('response_type'), 'code'); assert.equal(q.get('access_type'), 'offline'); assert.equal(q.get('prompt'), 'consent');
  assert.equal(q.get('login_hint'), SENDER); assert.equal(q.get('hd'), 'reyz.inc'); assert.equal(q.get('state'), 'abc');
  assert.deepEqual(q.get('scope').split(' '), SCOPES);
});

test('verifyIdentity: 本人なら ok、別の口座・別クライアント・未検証メール・偽 iss は拒否', () => {
  assert.deepEqual(verifyIdentity(claimsFor(SENDER), { clientId: CLIENT, sender: SENDER }), { ok: true, email: SENDER, hd: 'reyz.inc' });
  assert.equal(verifyIdentity(claimsFor('No-Reply@REYZ.inc'), { clientId: CLIENT, sender: SENDER }).ok, true);   // 大文字小文字は同一視
  const wrong = verifyIdentity(claimsFor('horiuchi@reyz.inc'), { clientId: CLIENT, sender: SENDER });
  assert.equal(wrong.ok, false); assert.match(wrong.reason, /horiuchi@reyz\.inc/); assert.equal(wrong.email, 'horiuchi@reyz.inc');
  assert.equal(verifyIdentity(claimsFor(SENDER, { aud: 'other' }), { clientId: CLIENT, sender: SENDER }).ok, false);
  assert.equal(verifyIdentity(claimsFor(SENDER, { email_verified: false }), { clientId: CLIENT, sender: SENDER }).ok, false);
  assert.equal(verifyIdentity(claimsFor(SENDER, { iss: 'https://evil.example' }), { clientId: CLIENT, sender: SENDER }).ok, false);
  assert.equal(verifyIdentity(claimsFor(SENDER, { exp: 1 }), { clientId: CLIENT, sender: SENDER, nowSec: Math.floor(now / 1000) }).ok, false);
  assert.throws(() => decodeIdToken('not-a-jwt'), /形式/);
});

test('exchange: 本人の同意 → refresh token を返し、失効は呼ばない。token endpoint には code / client / redirect_uri を正しく送る', async () => {
  const f = fakeFetch({ token: okToken() });
  const r = await exchange(deps(f), { code: ' 4/0Acode ', clientId: CLIENT, clientSecret: 'sec', sender: SENDER });
  assert.equal(r.ok, true); assert.equal(r.email, SENDER); assert.equal(r.hd, 'reyz.inc'); assert.equal(r.refreshToken, 'rt-new'); assert.equal(r.expires_in, 3599);
  assert.deepEqual(f.calls.map(c => c.url), [TOKEN_URL]);
  const b = f.calls[0].body;
  assert.equal(b.get('code'), '4/0Acode'); assert.equal(b.get('grant_type'), 'authorization_code'); assert.equal(b.get('client_id'), CLIENT);
  assert.equal(b.get('client_secret'), 'sec'); assert.equal(b.get('redirect_uri'), 'https://reyz.inc/oauth/callback.html');
});

test('exchange: 別の口座（個人）で同意されたら、受け取ったトークンをその場で失効させて失敗', async () => {
  const f = fakeFetch({ token: okToken('horiuchi@reyz.inc') });
  const r = await exchange(deps(f), { code: 'c', clientId: CLIENT, clientSecret: 'sec', sender: SENDER });
  assert.equal(r.ok, false); assert.match(r.reason, /horiuchi@reyz\.inc/); assert.equal(r.email, 'horiuchi@reyz.inc'); assert.equal(r.revoked, true);
  assert.equal(r.refreshToken, undefined);
  assert.deepEqual(f.calls.map(c => c.url), [TOKEN_URL, REVOKE_URL]);
  assert.equal(f.calls[1].body.get('token'), 'rt-new');   // 誤った同意のトークンを残さない
});

test('exchange: refresh_token 無し / gmail.send 未許可 / token endpoint の失敗は理由付きで失敗', async () => {
  const noRt = fakeFetch({ token: { body: { access_token: 'at', id_token: idToken(claimsFor(SENDER)), scope: 'openid https://www.googleapis.com/auth/gmail.send' } } });
  assert.match((await exchange(deps(noRt), { code: 'c', clientId: CLIENT, clientSecret: 'sec', sender: SENDER })).reason, /refresh_token/);
  const noScope = fakeFetch({ token: { body: { access_token: 'at', refresh_token: 'rt', id_token: idToken(claimsFor(SENDER)), scope: 'openid email' } } });
  const r2 = await exchange(deps(noScope), { code: 'c', clientId: CLIENT, clientSecret: 'sec', sender: SENDER });
  assert.equal(r2.ok, false); assert.match(r2.reason, /gmail\.send/); assert.equal(noScope.calls[1].url, REVOKE_URL);
  const bad = fakeFetch({ token: { body: { error: 'invalid_grant', error_description: 'Malformed auth code.' }, status: 400 } });
  const r3 = await exchange(deps(bad), { code: 'c', clientId: CLIENT, clientSecret: 'sec', sender: SENDER });
  assert.equal(r3.ok, false); assert.match(r3.reason, /invalid_grant/);
  await assert.rejects(() => exchange(deps(bad), { code: '', clientId: CLIENT, clientSecret: 'sec', sender: SENDER }), /CODE/);
});

test('revoke: 成功と、失効済み（400 invalid_token）は成功扱い。他のエラーは失敗', async () => {
  assert.equal((await revoke(deps(fakeFetch()), 'rt')).ok, true);
  const already = await revoke(deps(fakeFetch({ revokeStatus: 400 })), 'rt');
  assert.equal(already.ok, true); assert.equal(already.note, 'already invalid');
  const f = fakeFetch(); f.calls;
  const down = { fetch: async () => new Response('{"error":"internal"}', { status: 500 }), now: () => now };
  assert.equal((await revoke(down, 'rt')).ok, false);
});
