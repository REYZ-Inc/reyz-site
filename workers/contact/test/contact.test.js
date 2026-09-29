// ネットワーク不要の自己テスト（node --test）。Google / Turnstile は fetch の差し替えで再現する。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { handle, validate, buildMime, encodeHeader, makeJwt, pemToDer, addressOf, formatJst, b64url, resetTokenCache, shortCode, unverifiedReject } from '../src/index.js';

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

const env = (extra = {}) => ({
  CONTACT_RL: { limit: async () => ({ success: true }) },
  UNVERIFIED_POLICY: 'accept-flagged',
  GMAIL_SA_KEY: JSON.stringify({ type: 'service_account', client_email: 'contact-mailer@reyz-site.iam.gserviceaccount.com', private_key: pem }),
  GMAIL_SENDER_USER: 'sender@reyz.inc',
  TURNSTILE_SECRET_KEY: 'ts-secret',
  ALLOWED_ORIGINS: 'https://reyz.inc,https://www.reyz.inc',
  MAIL_TO: 'contact@reyz.inc',
  MAIL_FROM: 'REYZ Inc. <no-reply@reyz.inc>',
  ...extra
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
  const v = validate({ ...good(), client: { turnstile: 'blocked\u3042' }, dry_run: 'yes' });
  assert.deepEqual(v.errors, []); assert.equal(v.fields.client, 'blocked'); assert.equal(v.fields.dry_run, '');
  assert.equal(validate({ ...good(), client: 'x' }).fields.client, '');
  assert.equal(unverifiedReject({ name: 'a', person: '', message: 'see http://a.example http://b.example http://c.example' }, 'accept-flagged'), 'suspicious');
  assert.equal(unverifiedReject({ name: 'http://spam.example', person: '', message: 'x' }, 'accept-flagged'), 'suspicious');
  assert.equal(unverifiedReject({ name: 'a', person: '', message: 'x' }, 'reject'), 'turnstile');
  assert.equal(unverifiedReject({ name: 'a', person: '', message: 'x' }, undefined), null);
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
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true, verified: true, confirmation: true });
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
  for (const s of ['受付: 2026-09-28 18:30 JST', 'ご用件: AI基盤「Z」・SaaS導入', 'お名前: 株式会社テスト', 'ご担当者様: 山田', 'メール: taro@example.co.jp', '内容:\n導入の相談です。\n2行目', '国: JP / Ray: ray1', 'ボット対策: 検証済み']) assert.ok(copyText.includes(s), s);
  assert.ok(!copyText.includes('未検証'));
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

test('handle: 設定不足は 503。honeypot は未検証なら成功を装って捨て、検証済み（自動入力の人）なら注記付きで受け付ける', async () => {
  const f = fakeFetch();
  const e = env(); delete e.GMAIL_SA_KEY;
  const r = await handle(post(good()), e, deps(f));
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: 'not_configured' });
  const h = await handle(post({ ...good(), website: 'http://spam.example', turnstile: '' }), env(), deps(f));
  assert.equal(h.status, 200); assert.deepEqual(await h.json(), { ok: true });
  assert.deepEqual(f.calls, []);
  resetTokenCache();
  const f2 = fakeFetch();
  const ok = await handle(post({ ...good(), website: 'https://example.co.jp' }), env(), deps(f2));
  assert.deepEqual(await ok.json(), { ok: true, verified: true, confirmation: true });
  assert.ok(decodeBody(decodeRaw(f2.calls.find(c => c.url === GMAIL_URL).init)).includes('隠しフィールドに値が入っていました'));
});

test('handle: 未検証（トークン無し／不合格／hostname 不一致）は accept-flagged なら受け付け、控えだけ [未検証] で送り、確認メールは送らない', async () => {
  resetTokenCache();
  const f = fakeFetch();
  const r = await handle(post({ ...good(), turnstile: '', client: { turnstile: 'blocked' } }), env(), deps(f));
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, verified: false, confirmation: false });
  assert.deepEqual(f.calls.map(c => c.url), [TOKEN_URL, GMAIL_URL]);   // siteverify は呼ばず、控え 1 通だけ
  const copy = decodeRaw(f.calls[1].init);
  assert.equal(decodeSubject(copy), '[未検証] [REYZ お問い合わせ] AI基盤「Z」・SaaS導入｜株式会社テスト');
  const body = decodeBody(copy);
  assert.ok(body.includes('（未検証:')); assert.ok(body.includes('ボット対策: 未検証（form: blocked / siteverify: missing-input-response）'));
  // 不合格トークン → 同じく未検証で受付、codes を控えに残す
  const f2 = fakeFetch({ [TURNSTILE_URL]: () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }) });
  const r2 = await handle(post({ ...good(), client: { turnstile: 'ok' } }), env(), deps(f2));
  assert.equal(r2.status, 200); assert.equal((await r2.json()).verified, false);
  assert.ok(decodeBody(decodeRaw(f2.calls.find(c => c.url === GMAIL_URL).init)).includes('siteverify: invalid-input-secret'));
  const f3 = fakeFetch({ [TURNSTILE_URL]: () => Response.json({ success: true, hostname: 'evil.example' }) });
  assert.equal((await (await handle(post(good()), env(), deps(f3))).json()).verified, false);
  const f4 = fakeFetch({ [TURNSTILE_URL]: () => { throw new Error('down'); } });
  assert.equal((await (await handle(post(good()), env(), deps(f4))).json()).verified, false);
});

test('handle: 未検証の拒否 — policy=reject は 403 turnstile、リンクだらけは 403 suspicious、どちらも送らない', async () => {
  const f = fakeFetch();
  const r = await handle(post({ ...good(), turnstile: '' }), env({ UNVERIFIED_POLICY: 'reject' }), deps(f));
  assert.equal(r.status, 403); assert.deepEqual(await r.json(), { ok: false, error: 'turnstile', codes: ['missing-input-response'] });
  const s = await handle(post({ ...good(), turnstile: '', message: 'http://a.example http://b.example http://c.example' }), env(), deps(f));
  assert.equal(s.status, 403); assert.equal((await s.json()).error, 'suspicious');
  assert.deepEqual(f.calls, []);
  // 検証済みならリンクが多くても通る（ヒューリスティックは未検証経路だけ）
  const ok = await handle(post({ ...good(), message: 'http://a.example http://b.example http://c.example' }), env({ UNVERIFIED_POLICY: 'reject' }), deps(f));
  assert.equal(ok.status, 200);
});

test('handle: レート制限は全経路の前段（429、外部呼び出しなし）。binding が無ければ通す', async () => {
  const f = fakeFetch();
  const r = await handle(post(good()), env({ CONTACT_RL: { limit: async ({ key }) => ({ success: key !== '203.0.113.5' }) } }), deps(f));
  assert.equal(r.status, 429); assert.equal(r.headers.get('Retry-After'), '60'); assert.deepEqual(f.calls, []);
  const e = env(); delete e.CONTACT_RL;
  assert.equal((await handle(post(good()), e, deps(f))).status, 200);
});

test('handle: dry_run=true は照合まで、dry_run="token" は Google のトークン取得まで行い、どちらも送信しない', async () => {
  resetTokenCache();
  const f = fakeFetch();
  const r = await handle(post({ ...good(), dry_run: true, client: { turnstile: 'ok' } }), env(), deps(f));
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, dry_run: true, verified: true, codes: [], client: 'ok', rate_limit: 'ok' });
  assert.deepEqual(f.calls.map(c => c.url), [TURNSTILE_URL]);
  const r2 = await handle(post({ ...good(), dry_run: true, turnstile: '' }), env(), deps(f));
  assert.deepEqual(await r2.json(), { ok: true, dry_run: true, verified: false, codes: ['missing-input-response'], client: '', rate_limit: 'ok' });
  assert.equal(f.calls.length, 1);
  const r3 = await handle(post({ ...good(), dry_run: 'token' }), env(), deps(f));
  assert.deepEqual(await r3.json(), { ok: true, dry_run: true, verified: true, codes: [], client: '', rate_limit: 'ok', google_token: true });
  assert.deepEqual(f.calls.slice(1).map(c => c.url), [TURNSTILE_URL, TOKEN_URL]);   // Gmail は呼ばない
  resetTokenCache();
  const bad = fakeFetch({ [TOKEN_URL]: () => Response.json({ error: 'unauthorized_client' }, { status: 401 }) });
  const r4 = await handle(post({ ...good(), dry_run: 'token' }), env(), deps(bad));
  assert.equal(r4.status, 200); assert.deepEqual(await r4.json(), { ok: true, dry_run: true, verified: true, codes: [], client: '', rate_limit: 'ok', google_token: false, detail: 'unauthorized_client' });
  assert.equal(validate({ ...good(), dry_run: 'other' }).fields.dry_run, '');
});

test('handle: Google 側の失敗 — token 取得失敗と控えの送信失敗は 502、確認メールだけの失敗は 200 + confirmation:false', async () => {
  resetTokenCache();
  const bad = fakeFetch({ [TOKEN_URL]: () => Response.json({ error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method' }, { status: 401 }) });
  const r1 = await handle(post(good()), env(), deps(bad));
  assert.equal(r1.status, 502); assert.deepEqual(await r1.json(), { ok: false, error: 'send', stage: 'token', detail: 'unauthorized_client' });
  assert.ok(!bad.calls.some(c => c.url === GMAIL_URL));
  resetTokenCache();
  const copyFail = fakeFetch({ [GMAIL_URL]: () => new Response('{"error":{"code":403,"message":"Precondition check failed."}}', { status: 403 }) });
  const r2 = await handle(post(good()), env(), deps(copyFail));
  assert.equal(r2.status, 502); assert.deepEqual(await r2.json(), { ok: false, error: 'send', stage: 'copy', detail: 'Precondition check failed.' });
  assert.equal(copyFail.calls.filter(c => c.url === GMAIL_URL).length, 1);   // 控えが失敗したら確認メールは送らない
  resetTokenCache();
  let n = 0;
  const confFail = fakeFetch({ [GMAIL_URL]: () => (++n === 1 ? Response.json({ id: 'ok' }) : new Response('{"error":"x"}', { status: 400 })) });
  const r3 = await handle(post(good()), env(), deps(confFail));
  assert.equal(r3.status, 200); assert.deepEqual(await r3.json(), { ok: true, verified: true, confirmation: false });
  resetTokenCache();
  const broken = fakeFetch(); const e = env(); e.GMAIL_SA_KEY = '{"type":"service_account"}';
  const r4 = await handle(post(good()), e, deps(broken));
  assert.equal(r4.status, 502); assert.equal((await r4.json()).stage, 'token');
  assert.equal(shortCode('{"error":{"code":403,"message":"Gmail API has not been used","status":"PERMISSION_DENIED"}}'), 'PERMISSION_DENIED');
  assert.equal(shortCode('Error: token endpoint 400: {"error":"invalid_grant","error_description":"Invalid JWT Signature."}'), 'invalid_grant');
  assert.equal(shortCode('plain text'), 'plain text');
  assert.equal(shortCode('Error: GMAIL_SA_KEY: client_email / private_key がない'), 'Error: GMAIL_SA_KEY: client_email / private_key がない');
});
