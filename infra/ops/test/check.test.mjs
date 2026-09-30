// ネットワーク不要の self-test（node --test infra/ops/test）。外部 API は fetch の差し替えで再現する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readSiteKey, appJwt, checkPresence, checkCloudflareToken, checkTurnstileSecret, checkOAuthClientAuthz, checkOAuthClientSecret, checkRefreshToken, checkGitHubApp, checkCallbackPage, runAll, REQUIRED_APP_PERMISSIONS } from '../check.mjs';

const CLIENT = 'cid.apps.googleusercontent.com', SENDER = 'no-reply@reyz.inc', REDIRECT = 'https://reyz.inc/oauth/callback.html';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const b64 = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = email => `${b64('{"alg":"RS256"}')}.${b64(JSON.stringify({ email, email_verified: true }))}.sig`;
const json = (body, status = 200) => Response.json(body, { status });
const html = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'text/html' } });

/** URL の先頭一致で応答を返す fetch。呼び出しは calls に残す（秘密が URL に出ていないかも見る） */
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body || '', auth: (init.headers || {}).Authorization || '' });
    for (const [prefix, handler] of routes) if (url.startsWith(prefix)) return typeof handler === 'function' ? handler(url, init) : handler();
    return new Response('unexpected ' + url, { status: 500 });
  };
  f.calls = calls; return f;
}
const deps = f => ({ fetch: f, now: () => Date.UTC(2026, 8, 30), readFile: () => "CONFIG = { turnstileSiteKey: '0x4AAAAsitekey', x: 1 }" });

test('readSiteKey / appJwt（RS256 の署名が検証できる）', () => {
  assert.equal(readSiteKey("a\n    turnstileSiteKey: '0x4AAAAAAFIPs9iKoP2Ouj0x',   // c"), '0x4AAAAAAFIPs9iKoP2Ouj0x');
  assert.equal(readSiteKey(''), '');
  const jwt = appJwt('12345', PEM, 1_800_000_000);
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64')), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64')), { iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: 12345 });
  assert.equal(JSON.parse(Buffer.from(appJwt('Iv1.abc', PEM, 1).split('.')[1], 'base64')).iss, 'Iv1.abc');
  assert.equal(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(privateKey, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')), true);
});

test('C1: 有無と形式。未設定と形式不正を列挙し、値は公開の変数だけ出す', async () => {
  const full = { CLOUDFLARE_TURNSTILE_TOKEN: 't', CLOUDFLARE_WORKERS_TOKEN: 't', TURNSTILE_SECRET_KEY: 's', GMAIL_OAUTH_CLIENT_ID: CLIENT, GMAIL_OAUTH_CLIENT_SECRET: 'x', GMAIL_OAUTH_REFRESH_TOKEN: 'r', OPS_APP_PRIVATE_KEY: PEM, OPS_APP_ID: '12', MAIL_SENDER_USER: SENDER, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), NOC_EMAIL: 'noc@reyz.inc' };
  const ok = await checkPresence(full);
  assert.equal(ok.status, 'PASS'); assert.match(ok.detail, /MAIL_SENDER_USER=no-reply@reyz\.inc/); assert.doesNotMatch(ok.detail, /'x'|rt|PRIVATE/);
  const r = await checkPresence({ ...full, CLOUDFLARE_TURNSTILE_TOKEN: '', OPS_APP_ID: 'abc', MAIL_SENDER_USER: '' });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /未設定: secrets\.CLOUDFLARE_TURNSTILE_TOKEN, vars\.MAIL_SENDER_USER/); assert.match(r.detail, /形式が不正: vars\.OPS_APP_ID=abc/);
});

test('C2/C3: Cloudflare トークン。verify → active、Turnstile 回転用はウィジェットを読めて PASS。権限不足・無効・期限は FAIL', async () => {
  const good = fakeFetch([[ 'https://api.cloudflare.com/client/v4/user/tokens/verify', () => json({ success: true, result: { status: 'active', expires_on: null } }) ],
    [ 'https://api.cloudflare.com/client/v4/accounts/acct/challenges/widgets/0x4AAAAsitekey', () => json({ success: true, result: { name: 'reyz-site-contact', domains: ['reyz.inc', 'www.reyz.inc'] } }) ]]);
  const r = await checkCloudflareToken(deps(good), { id: 'C2', label: 'cf', token: 'cf-value-xyz', accountId: 'acct', siteKey: '0x4AAAAsitekey', needWidget: true });
  assert.equal(r.status, 'PASS'); assert.match(r.detail, /期限なし/); assert.match(r.detail, /reyz-site-contact/);
  assert.ok(good.calls.every(c => c.auth === 'Bearer cf-value-xyz' && !c.url.includes('cf-value-xyz')));
  const noPerm = fakeFetch([[ 'https://api.cloudflare.com/client/v4/user/tokens/verify', () => json({ success: true, result: { status: 'active' } }) ],
    [ 'https://api.cloudflare.com/client/v4/accounts/', () => json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403) ]]);
  const r2 = await checkCloudflareToken(deps(noPerm), { id: 'C2', label: 'cf', token: 'tok', accountId: 'acct', siteKey: '0x4AAAAsitekey', needWidget: true });
  assert.equal(r2.status, 'FAIL'); assert.match(r2.detail, /ウィジェットを読めない（HTTP 403/); assert.match(r2.next, /Turnstile \| 編集/);
  const invalid = fakeFetch([[ 'https://api.cloudflare.com/client/v4/user/tokens/verify', () => json({ success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] }, 401) ]]);
  assert.equal((await checkCloudflareToken(deps(invalid), { id: 'C3', label: 'cf', token: 'tok', needWidget: false })).status, 'FAIL');
  const expired = fakeFetch([[ 'https://api.cloudflare.com/client/v4/user/tokens/verify', () => json({ success: true, result: { status: 'expired' } }) ]]);
  assert.match((await checkCloudflareToken(deps(expired), { id: 'C3', label: 'cf', token: 'tok', needWidget: false })).detail, /状態が expired/);
  assert.equal((await checkCloudflareToken(deps(good), { id: 'C3', label: 'cf', token: '', needWidget: false })).status, 'SKIP');
  const noKey = await checkCloudflareToken(deps(good), { id: 'C2', label: 'cf', token: 'tok', accountId: '', siteKey: '0x4AAAAsitekey', needWidget: true });
  assert.equal(noKey.status, 'FAIL'); assert.match(noKey.detail, /account=無し/);
});

test('C4: Turnstile 秘密キー。invalid-input-response は鍵が有効、invalid-input-secret は FAIL、秘密は body にだけ入る', async () => {
  const valid = fakeFetch([[ 'https://challenges.cloudflare.com/turnstile/v0/siteverify', () => json({ success: false, 'error-codes': ['invalid-input-response'] }) ]]);
  const r = await checkTurnstileSecret(deps(valid), { secret: 'sec' });
  assert.equal(r.status, 'PASS'); assert.equal(valid.calls[0].method, 'POST'); assert.match(valid.calls[0].body, /secret=sec/); assert.match(valid.calls[0].body, /response=ops-check-probe/);
  const wrong = fakeFetch([[ 'https://challenges.cloudflare.com/turnstile/v0/siteverify', () => json({ success: false, 'error-codes': ['invalid-input-secret'] }) ]]);
  assert.equal((await checkTurnstileSecret(deps(wrong), { secret: 'sec' })).status, 'FAIL');
  const testKey = fakeFetch([[ 'https://challenges.cloudflare.com/turnstile/v0/siteverify', () => json({ success: true }) ]]);
  assert.match((await checkTurnstileSecret(deps(testKey), { secret: 'sec' })).detail, /テスト用/);
  assert.equal((await checkTurnstileSecret(deps(valid), { secret: '' })).status, 'SKIP');
});

test('C5: 認可 endpoint。redirect_uri_mismatch / invalid_client のページは FAIL、ログイン画面（200/302）は PASS。ログインはしない', async () => {
  const mismatch = fakeFetch([[ 'https://accounts.google.com/o/oauth2/v2/auth', () => html('<html>Error 400: redirect_uri_mismatch</html>', 400) ]]);
  const r = await checkOAuthClientAuthz(deps(mismatch), { clientId: CLIENT, redirectUri: REDIRECT });
  assert.equal(r.status, 'FAIL'); assert.match(r.detail, /redirect_uri_mismatch/); assert.match(r.next, /URI を追加/);
  const u = new URL(mismatch.calls[0].url); assert.equal(u.searchParams.get('client_id'), CLIENT); assert.equal(u.searchParams.get('redirect_uri'), REDIRECT); assert.equal(u.searchParams.get('scope'), 'openid');
  const notFound = fakeFetch([[ 'https://accounts.google.com/o/oauth2/v2/auth', () => html('Error 401: invalid_client The OAuth client was not found.', 401) ]]);
  assert.match((await checkOAuthClientAuthz(deps(notFound), { clientId: CLIENT, redirectUri: REDIRECT })).detail, /invalid_client/);
  const login = fakeFetch([[ 'https://accounts.google.com/o/oauth2/v2/auth', () => new Response('', { status: 302, headers: { Location: 'https://accounts.google.com/signin' } }) ]]);
  assert.equal((await checkOAuthClientAuthz(deps(login), { clientId: CLIENT, redirectUri: REDIRECT })).status, 'PASS');
  assert.equal((await checkOAuthClientAuthz(deps(login), { clientId: '', redirectUri: REDIRECT })).status, 'SKIP');
});

test('C6: token endpoint に偽コード。invalid_grant は PASS（クライアント認証は通過）、invalid_client は FAIL', async () => {
  const ok = fakeFetch([[ 'https://oauth2.googleapis.com/token', () => json({ error: 'invalid_grant', error_description: 'Malformed auth code.' }, 400) ]]);
  const r = await checkOAuthClientSecret(deps(ok), { clientId: CLIENT, clientSecret: 'sec', redirectUri: REDIRECT });
  assert.equal(r.status, 'PASS'); const b = new URLSearchParams(ok.calls[0].body); assert.equal(b.get('code'), 'ops-check-probe'); assert.equal(b.get('client_secret'), 'sec'); assert.equal(b.get('redirect_uri'), REDIRECT);
  const bad = fakeFetch([[ 'https://oauth2.googleapis.com/token', () => json({ error: 'invalid_client', error_description: 'Unauthorized' }, 401) ]]);
  const r2 = await checkOAuthClientSecret(deps(bad), { clientId: CLIENT, clientSecret: 'sec', redirectUri: REDIRECT });
  assert.equal(r2.status, 'FAIL'); assert.match(r2.next, /シークレットを追加/);
  assert.equal((await checkOAuthClientSecret(deps(ok), { clientId: CLIENT, clientSecret: '', redirectUri: REDIRECT })).status, 'SKIP');
});

test('C7: リフレッシュトークン。access token が取れて gmail.send があれば PASS。id_token があれば口座も判定。失効は FAIL', async () => {
  const oldConsent = fakeFetch([[ 'https://oauth2.googleapis.com/token', () => json({ access_token: 'at', expires_in: 3599, scope: 'https://www.googleapis.com/auth/gmail.send', token_type: 'Bearer' }) ]]);
  const r = await checkRefreshToken(deps(oldConsent), { clientId: CLIENT, clientSecret: 'sec', refreshToken: 'rt', sender: SENDER });
  assert.equal(r.status, 'PASS'); assert.match(r.detail, /scope: gmail\.send/); assert.match(r.detail, /口座は不明/);
  assert.equal(new URLSearchParams(oldConsent.calls[0].body).get('grant_type'), 'refresh_token');
  const newConsent = fakeFetch([[ 'https://oauth2.googleapis.com/token', () => json({ access_token: 'at', expires_in: 3599, scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send', id_token: idToken('No-Reply@reyz.inc') }) ]]);
  const r2 = await checkRefreshToken(deps(newConsent), { clientId: CLIENT, clientSecret: 'sec', refreshToken: 'rt', sender: SENDER });
  assert.equal(r2.status, 'PASS'); assert.match(r2.detail, /同意した口座: no-reply@reyz\.inc/);
  const wrongUser = fakeFetch([[ 'https://oauth2.googleapis.com/token', () => json({ access_token: 'at', scope: 'openid email https://www.googleapis.com/auth/gmail.send', id_token: idToken('horiuchi@reyz.inc') }) ]]);
  const r3 = await checkRefreshToken(deps(wrongUser), { clientId: CLIENT, clientSecret: 'sec', refreshToken: 'rt', sender: SENDER });
  assert.equal(r3.status, 'FAIL'); assert.match(r3.detail, /horiuchi@reyz\.inc（期待: no-reply@reyz\.inc）/);
  const revoked = fakeFetch([[ 'https://oauth2.googleapis.com/token', () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400) ]]);
  const r4 = await checkRefreshToken(deps(revoked), { clientId: CLIENT, clientSecret: 'sec', refreshToken: 'rt', sender: SENDER });
  assert.equal(r4.status, 'FAIL'); assert.match(r4.detail, /revoked/); assert.match(r4.next, /同意をやり直す/);
  const noSend = fakeFetch([[ 'https://oauth2.googleapis.com/token', () => json({ access_token: 'at', scope: 'openid email' }) ]]);
  assert.match((await checkRefreshToken(deps(noSend), { clientId: CLIENT, clientSecret: 'sec', refreshToken: 'rt', sender: SENDER })).detail, /gmail\.send が無い/);
});

function ghRoutes({ appOk = true, installed = true, perms = { actions: 'write', secrets: 'write', issues: 'write', metadata: 'read' }, selection = 'selected', repos = ['REYZ-Inc/reyz-site'] } = {}) {
  return [
    [ 'https://api.github.com/app/installations/77/access_tokens', () => json({ token: 'ghs_x' }, 201) ],
    [ 'https://api.github.com/app/installations', () => json(installed ? [{ id: 77, account: { login: 'reyz-inc' }, permissions: perms, repository_selection: selection }] : []) ],
    [ 'https://api.github.com/app', () => appOk ? json({ id: 12345, slug: 'reyz-ops', name: 'REYZ Ops' }) : json({ message: 'A JSON web token could not be decoded' }, 401) ],
    [ 'https://api.github.com/installation/repositories', () => json({ total_count: repos.length, repositories: repos.map(full_name => ({ full_name })) }) ],
  ];
}

test('C8: GitHub App。鍵と ID の一致 → インストール → 権限 → repo の順に判定。JWT は Authorization にだけ入る', async () => {
  const good = fakeFetch(ghRoutes());
  const r = await checkGitHubApp(deps(good), { appId: '12345', pem: PEM, owner: 'REYZ-Inc', repo: 'reyz-site', nowSec: 1_800_000_000 });
  assert.equal(r.status, 'PASS'); assert.match(r.detail, /reyz-ops/); assert.match(r.detail, /actions:write secrets:write issues:write metadata:read/);
  assert.deepEqual(good.calls.map(c => c.url.replace('https://api.github.com', '')), ['/app', '/app/installations', '/app/installations/77/access_tokens', '/installation/repositories?per_page=100']);
  assert.ok(good.calls.slice(0, 3).every(c => c.auth.startsWith('Bearer eyJ')));
  const badKey = await checkGitHubApp(deps(fakeFetch(ghRoutes({ appOk: false }))), { appId: '12345', pem: PEM, owner: 'REYZ-Inc', repo: 'reyz-site' });
  assert.equal(badKey.status, 'FAIL'); assert.match(badKey.detail, /一致しない/);
  const notInstalled = await checkGitHubApp(deps(fakeFetch(ghRoutes({ installed: false }))), { appId: '12345', pem: PEM, owner: 'REYZ-Inc', repo: 'reyz-site' });
  assert.equal(notInstalled.status, 'FAIL'); assert.match(notInstalled.next, /Install App/);
  const lacking = await checkGitHubApp(deps(fakeFetch(ghRoutes({ perms: { actions: 'write', secrets: 'read', metadata: 'read' } }))), { appId: '12345', pem: PEM, owner: 'REYZ-Inc', repo: 'reyz-site' });
  assert.equal(lacking.status, 'FAIL'); assert.match(lacking.detail, /secrets:write（現在 read）/); assert.match(lacking.detail, /issues:write（現在 無し）/);
  const otherRepo = await checkGitHubApp(deps(fakeFetch(ghRoutes({ repos: ['REYZ-Inc/other'] }))), { appId: '12345', pem: PEM, owner: 'REYZ-Inc', repo: 'reyz-site' });
  assert.equal(otherRepo.status, 'FAIL'); assert.match(otherRepo.detail, /reyz-site が無い/);
  assert.equal((await checkGitHubApp(deps(fakeFetch(ghRoutes({ selection: 'all', repos: [] }))), { appId: '12345', pem: PEM, owner: 'REYZ-Inc', repo: 'reyz-site' })).status, 'PASS');
  const garbage = await checkGitHubApp(deps(fakeFetch(ghRoutes())), { appId: '12345', pem: 'not a key', owner: 'REYZ-Inc', repo: 'reyz-site' });
  assert.equal(garbage.status, 'FAIL'); assert.match(garbage.detail, /秘密鍵を読めない/);
  assert.equal((await checkGitHubApp(deps(fakeFetch(ghRoutes())), { appId: '', pem: PEM, owner: 'REYZ-Inc', repo: 'reyz-site' })).status, 'SKIP');
  assert.deepEqual(Object.keys(REQUIRED_APP_PERMISSIONS), ['actions', 'secrets', 'issues', 'metadata']);
});

test('C9: 受け取りページの公開値が Secret・変数・repo と一致するか', async () => {
  const page = `var CONFIG = { clientId: '${CLIENT}', sender: 'no-reply@reyz.inc', workflowUrl: 'https://github.com/REYZ-Inc/reyz-site/actions/workflows/oauth-consent.yml' };`;
  const ok = fakeFetch([[ REDIRECT, () => html(page) ]]);
  assert.equal((await checkCallbackPage(deps(ok), { url: REDIRECT, clientId: CLIENT, sender: SENDER, repository: 'REYZ-Inc/reyz-site' })).status, 'PASS');
  const stale = fakeFetch([[ REDIRECT, () => html(page.replace(CLIENT, 'old.apps.googleusercontent.com')) ]]);
  const r = await checkCallbackPage(deps(stale), { url: REDIRECT, clientId: CLIENT, sender: SENDER, repository: 'REYZ-Inc/reyz-site' });
  assert.equal(r.status, 'FAIL'); assert.match(r.detail, /clientId が Secret GMAIL_OAUTH_CLIENT_ID と不一致/); assert.doesNotMatch(r.detail, /old\.apps/);
  const down = fakeFetch([[ REDIRECT, () => html('', 503) ]]);
  assert.match((await checkCallbackPage(deps(down), { url: REDIRECT, clientId: CLIENT, sender: SENDER, repository: 'REYZ-Inc/reyz-site' })).detail, /HTTP 503/);
});

test('runAll: 9 項目を返し、未設定は SKIP、FAIL が無ければ ok。秘密の値はどの detail にも出ない', async () => {
  const f = fakeFetch([[ 'https://api.cloudflare.com/client/v4/user/tokens/verify', () => json({ success: true, result: { status: 'active' } }) ],
    [ 'https://api.cloudflare.com/client/v4/accounts/', () => json({ success: true, result: { name: 'w', domains: ['reyz.inc'] } }) ],
    [ 'https://challenges.cloudflare.com/', () => json({ success: false, 'error-codes': ['invalid-input-response'] }) ],
    [ 'https://accounts.google.com/', () => new Response('', { status: 302 }) ],
    [ 'https://oauth2.googleapis.com/token', (u, init) => new URLSearchParams(init.body).get('grant_type') === 'refresh_token' ? json({ access_token: 'at', scope: 'https://www.googleapis.com/auth/gmail.send' }) : json({ error: 'invalid_grant' }, 400) ],
    [ REDIRECT, () => html(`clientId: '${CLIENT}', sender: 'no-reply@reyz.inc', workflowUrl: 'https://github.com/REYZ-Inc/reyz-site/actions/workflows/oauth-consent.yml'`) ],
    ...ghRoutes()]);
  const env = { GITHUB_REPOSITORY: 'REYZ-Inc/reyz-site', CLOUDFLARE_TURNSTILE_TOKEN: 'cf-secret-1', CLOUDFLARE_WORKERS_TOKEN: 'cf-secret-2', TURNSTILE_SECRET_KEY: 'ts-secret', GMAIL_OAUTH_CLIENT_ID: CLIENT, GMAIL_OAUTH_CLIENT_SECRET: 'gcs-secret', GMAIL_OAUTH_REFRESH_TOKEN: 'rt-secret', OPS_APP_PRIVATE_KEY: PEM, OPS_APP_ID: '12345', MAIL_SENDER_USER: SENDER, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), NOC_EMAIL: 'noc@reyz.inc' };
  const r = await runAll(deps(f), env);
  assert.deepEqual(r.items.map(i => i.id), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']);
  assert.equal(r.ok, true); assert.equal(r.pass, 9); assert.equal(r.fail, 0);
  const text = JSON.stringify(r);
  for (const s of ['cf-secret-1', 'cf-secret-2', 'ts-secret', 'gcs-secret', 'rt-secret', 'PRIVATE KEY']) assert.doesNotMatch(text, new RegExp(s));
  const partial = await runAll(deps(f), { GITHUB_REPOSITORY: 'REYZ-Inc/reyz-site', MAIL_SENDER_USER: SENDER });
  assert.equal(partial.ok, false); assert.equal(partial.items[0].status, 'FAIL');
  assert.deepEqual(partial.items.slice(1, 8).map(i => i.status), ['SKIP', 'SKIP', 'SKIP', 'SKIP', 'SKIP', 'SKIP', 'SKIP']);
  assert.equal(partial.items[8].status, 'PASS');   // 受け取りページは Secret なしでも到達性と sender を見る
});
