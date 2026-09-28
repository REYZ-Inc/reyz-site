// ネットワーク不要の自己テスト（node --test）。Google / Turnstile は fetch の差し替えで再現する。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { handle, validate, buildMime, encodeHeader, makeJwt, pemToDer, addressOf, formatJst, b64url, resetTokenCache } from '../src/index.js';

const ORIGIN = 'https://reyz.inc';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

let pem = '', publicKey = null;
before(async () => {   // テスト用の鍵（実鍵は使わない）
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n');
  pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
  publicKey = kp.publicKey;
});

const env = () => ({
  GMAIL_SA_KEY: JSON.stringify({ type: 'service_account', client_email: 'contact-mailer@reyz-site.iam.gserviceaccount.com', private_key: pem }),
  GMAIL_SENDER_USER: 'sender@reyz.inc',
  TURNSTILE_SECRET_KEY: 'ts-secret',
  ALLOWED_ORIGINS: 'https://reyz.inc,https://www.reyz.inc',
  MAIL_TO: 'contact@reyz.inc',
  MAIL_FROM: 'REYZ Inc. <no-reply@reyz.inc>'
});

const good = () => ({ name: '株式会社テスト', person: '山田', email: 'taro@example.co.jp', type: 'AI基盤「Z」・SaaS導入', message: '導入の相談です。\n2行目', turnstile: 'tok', website: '' });

function post(body, { origin = ORIGIN, headers = {}, method = 'POST', path = '/api/contact' } = {}) {
  const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5', 'CF-IPCountry': 'JP', 'CF-Ray': 'ray1', ...headers };
  if (origin !== null) h.Origin = origin;
  return new Request('https://reyz.inc' + path, { method, headers: h, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
}

// 差し替え fetch: 呼び出しを記録し、URL ごとの応答を返す
function fakeFetch(overrides = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    if (overrides[url]) return overrides[url](init, calls);
    if (url === TURNSTILE_URL) return Response.json({ success: true, hostname: 'reyz.inc' });
    if (url === TOKEN_URL) return Response.json({ access_token: 'at-1', expires_in: 3600, token_type: 'Bearer' });
    if (url === GMAIL_URL) return Response.json({ id: 'msg-' + calls.filter(c => c.url === GMAIL_URL).length });
    return new Response('unexpected ' + url, { status: 500 });
  };
  f.calls = calls; return f;
}
const decodeRaw = init => Buffer.from(JSON.parse(init.body).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const decodeBody = mime => Buffer.from(mime.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
const decodeSubject = mime => (/^Subject: ([\s\S]*?)\r\n(?! )/m.exec(mime)[1]).split(/\r\n /).map(w => Buffer.from(w.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, ''), 'base64').toString('utf8')).join('');
let now = Date.UTC(2026, 8, 28, 9, 30, 0);   // 2026-09-28 18:30 JST
const deps = f => ({ fetch: f, now: () => now });

test('validate: 正常値は整形して通し、不正は項目名で返す', () => {
  const ok = validate({ ...good(), name: '  株式会社テスト\r\n改行 ', message: 'a\r\nb\u0000c' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.fields.name, '株式会社テスト 改行');     // 単一行項目の改行は空白に（ヘッダ注入防止）
  assert.equal(ok.fields.message, 'a\nbc');               // 複数行は保持、制御文字は除去
  const bad = validate({ name: '', email: 'not-an-email', type: 'x', message: 'y' });
  assert.deepEqual(bad.errors, ['name', 'email']);
  assert.deepEqual(validate({ ...good(), message: 'x'.repeat(5001) }).errors, ['message']);
  assert.deepEqual(validate({ ...good(), name: ['x'] }).errors, ['name']);
  assert.deepEqual(validate({ ...good(), email: 'a@b' }).errors, ['email']);
});

test('encodeHeader / buildMime: 日本語件名は 75 文字以下の encoded-word、本文は base64 で往復する', () => {
  assert.equal(encodeHeader('Plain subject'), 'Plain subject');
  const subj = '【REYZ】お問い合わせを受け付けました — とても長い件名をここに書いて折り返しを確かめる';
  const enc = encodeHeader(subj);
  for (const w of enc.split('\r\n ')) { assert.ok(w.length <= 75, w); assert.match(w, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/); }
  const mime = buildMime({ from: 'REYZ Inc. <no-reply@reyz.inc>', to: 'taro@example.co.jp', replyTo: 'contact@reyz.inc', subject: subj, text: 'こんにちは\n2行目 ' + 'x'.repeat(300) });
  assert.equal(decodeSubject(mime), subj);
  assert.equal(decodeBody(mime), 'こんにちは\n2行目 ' + 'x'.repeat(300));
  for (const line of mime.split('\r\n')) assert.ok(line.length <= 78, line);
  assert.match(mime, /^From: REYZ Inc\. <no-reply@reyz\.inc>\r\nTo: taro@example\.co\.jp\r\nReply-To: contact@reyz\.inc\r\nSubject: /);
  assert.match(mime, /\r\nContent-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n/);
  assert.equal(addressOf('REYZ Inc. <no-reply@reyz.inc>'), 'no-reply@reyz.inc'); assert.equal(addressOf('contact@reyz.inc'), 'contact@reyz.inc');
  assert.equal(formatJst(now), '2026-09-28 18:30 JST');
});

test('makeJwt: RS256 署名が公開鍵で検証でき、claims が委任の形になっている', async () => {
  const sa = { client_email: 'contact-mailer@reyz-site.iam.gserviceaccount.com', private_key: pem };
  const jwt = await makeJwt(sa, 'sender@reyz.inc', now);
  const [h, c, s] = jwt.split('.');
  const dec = x => JSON.parse(Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.deepEqual(dec(h), { alg: 'RS256', typ: 'JWT' });
  const claims = dec(c);
  assert.equal(claims.iss, sa.client_email); assert.equal(claims.sub, 'sender@reyz.inc');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/gmail.send'); assert.equal(claims.aud, TOKEN_URL);
  assert.equal(claims.iat, Math.floor(now / 1000)); assert.equal(claims.exp, claims.iat + 3600);
  const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  assert.equal(await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, publicKey, sig, new TextEncoder().encode(h + '.' + c)), true);
  assert.equal(pemToDer(pem).length > 1000, true);
  assert.equal(b64url(new Uint8Array([251, 255])), '-_8');
});

test('handle: 正常系 — Turnstile → token → 控え → 確認メールの順で送り、token は再利用される', async () => {
  resetTokenCache();
  const f = fakeFetch();
  const res = await handle(post(good()), env(), deps(f));
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true, confirmation: true });
  assert.deepEqual(f.calls.map(c => c.url), [TURNSTILE_URL, TOKEN_URL, GMAIL_URL, GMAIL_URL]);
  const ts = new URLSearchParams(f.calls[0].init.body);
  assert.equal(ts.get('secret'), 'ts-secret'); assert.equal(ts.get('response'), 'tok'); assert.equal(ts.get('remoteip'), '203.0.113.5');
  const tok = new URLSearchParams(f.calls[1].init.body);
  assert.equal(tok.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer'); assert.equal(tok.get('assertion').split('.').length, 3);
  assert.equal(f.calls[2].init.headers.Authorization, 'Bearer at-1');
  const copy = decodeRaw(f.calls[2].init), conf = decodeRaw(f.calls[3].init);
  assert.match(copy, /^From: REYZ Inc\. <no-reply@reyz\.inc>\r\nTo: contact@reyz\.inc\r\nReply-To: taro@example\.co\.jp\r\n/);
  assert.equal(decodeSubject(copy), '[REYZ お問い合わせ] AI基盤「Z」・SaaS導入｜株式会社テスト');
  const copyText = decodeBody(copy);
  for (const s of ['受付: 2026-09-28 18:30 JST', 'ご用件: AI基盤「Z」・SaaS導入', 'お名前: 株式会社テスト', 'ご担当者様: 山田', 'メール: taro@example.co.jp', '内容:\n導入の相談です。\n2行目', '国: JP / Ray: ray1']) assert.ok(copyText.includes(s), s);
  assert.match(conf, /^From: REYZ Inc\. <no-reply@reyz\.inc>\r\nTo: taro@example\.co\.jp\r\nReply-To: contact@reyz\.inc\r\n/);
  assert.equal(decodeSubject(conf), '【REYZ】お問い合わせを受け付けました');
  const confText = decodeBody(conf);
  for (const s of ['株式会社テスト 様（山田 様）', 'お問い合わせを受け付けました', '受付日時: 2026-09-28 18:30 JST', '内容:\n導入の相談です。\n2行目', 'contact@reyz.inc', 'https://reyz.inc']) assert.ok(confText.includes(s), s);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  // 2 回目: token は cache から（token endpoint は呼ばれない）
  const res2 = await handle(post({ ...good(), person: '' }), env(), deps(f));
  assert.equal(res2.status, 200);
  assert.deepEqual(f.calls.slice(4).map(c => c.url), [TURNSTILE_URL, GMAIL_URL, GMAIL_URL]);
  assert.ok(!decodeBody(decodeRaw(f.calls[5].init)).includes('ご担当者様'));
  // 期限が近づくと取り直す
  now += 3541 * 1000;
  await handle(post(good()), env(), deps(f));
  assert.deepEqual(f.calls.slice(7).map(c => c.url), [TURNSTILE_URL, TOKEN_URL, GMAIL_URL, GMAIL_URL]);
});

test('handle: 入口の拒否（path / method / origin / content-type / size / json / validation）', async () => {
  const f = fakeFetch(); const e = env();
  assert.equal((await handle(post(good(), { path: '/api/other' }), e, deps(f))).status, 404);
  assert.equal((await handle(post(null, { method: 'GET' }), e, deps(f))).status, 405);
  assert.equal((await handle(post(null, { method: 'OPTIONS' }), e, deps(f))).status, 204);
  assert.equal((await handle(post(good(), { origin: 'https://evil.example' }), e, deps(f))).status, 403);
  assert.equal((await handle(post(good(), { origin: null }), e, deps(f))).status, 403);
  assert.equal((await handle(post(good(), { headers: { 'Content-Type': 'text/plain' } }), e, deps(f))).status, 415);
  assert.equal((await handle(post({ ...good(), message: 'x'.repeat(40000) }), e, deps(f))).status, 413);
  assert.equal((await handle(post('{bad json'), e, deps(f))).status, 400);
  assert.equal((await handle(post([1, 2]), e, deps(f))).status, 400);
  const v = await handle(post({ ...good(), email: 'bad', name: '' }), e, deps(f));
  assert.equal(v.status, 400); assert.deepEqual(await v.json(), { ok: false, error: 'validation', fields: ['name', 'email'] });
  assert.deepEqual(f.calls, []);   // 拒否では外部に何も送らない
});

test('handle: 設定不足は 503、honeypot は成功を装って何も送らない', async () => {
  const f = fakeFetch();
  const e = env(); delete e.GMAIL_SA_KEY;
  const r = await handle(post(good()), e, deps(f));
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: 'not_configured' });
  const h = await handle(post({ ...good(), website: 'http://spam.example' }), env(), deps(f));
  assert.equal(h.status, 200); assert.deepEqual(await h.json(), { ok: true });
  assert.deepEqual(f.calls, []);
});

test('handle: Turnstile 不合格・欠落・hostname 不一致は 403 で送らない', async () => {
  resetTokenCache();
  const f = fakeFetch({ [TURNSTILE_URL]: () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }) });
  const r = await handle(post(good()), env(), deps(f));
  assert.equal(r.status, 403); assert.deepEqual(await r.json(), { ok: false, error: 'turnstile', codes: ['invalid-input-response'] });
  const m = await handle(post({ ...good(), turnstile: '' }), env(), deps(f));
  assert.equal(m.status, 403); assert.deepEqual((await m.json()).codes, ['missing-input-response']);
  const f2 = fakeFetch({ [TURNSTILE_URL]: () => Response.json({ success: true, hostname: 'evil.example' }) });
  const hm = await handle(post(good()), env(), deps(f2));
  assert.equal(hm.status, 403); assert.deepEqual((await hm.json()).codes, ['hostname-mismatch']);
  const f3 = fakeFetch({ [TURNSTILE_URL]: () => { throw new Error('down'); } });
  assert.equal((await handle(post(good()), env(), deps(f3))).status, 403);
  assert.ok(![...f.calls, ...f2.calls, ...f3.calls].some(c => c.url === GMAIL_URL || c.url === TOKEN_URL));
});

test('handle: Google 側の失敗 — token 取得失敗と控えの送信失敗は 502、確認メールだけの失敗は 200 + confirmation:false', async () => {
  resetTokenCache();
  const bad = fakeFetch({ [TOKEN_URL]: () => Response.json({ error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method' }, { status: 401 }) });
  const r1 = await handle(post(good()), env(), deps(bad));
  assert.equal(r1.status, 502); assert.deepEqual(await r1.json(), { ok: false, error: 'send' });
  assert.ok(!bad.calls.some(c => c.url === GMAIL_URL));
  resetTokenCache();
  const copyFail = fakeFetch({ [GMAIL_URL]: () => new Response('{"error":{"code":403,"message":"Precondition check failed."}}', { status: 403 }) });
  const r2 = await handle(post(good()), env(), deps(copyFail));
  assert.equal(r2.status, 502); assert.equal(copyFail.calls.filter(c => c.url === GMAIL_URL).length, 1);   // 控えが失敗したら確認メールは送らない
  resetTokenCache();
  let n = 0;
  const confFail = fakeFetch({ [GMAIL_URL]: () => (++n === 1 ? Response.json({ id: 'ok' }) : new Response('{"error":"x"}', { status: 400 })) });
  const r3 = await handle(post(good()), env(), deps(confFail));
  assert.equal(r3.status, 200); assert.deepEqual(await r3.json(), { ok: true, confirmation: false });
  resetTokenCache();
  const broken = fakeFetch(); const e = env(); e.GMAIL_SA_KEY = '{"type":"service_account"}';
  assert.equal((await handle(post(good()), e, deps(broken))).status, 502);
});
