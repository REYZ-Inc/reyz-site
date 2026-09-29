/* REYZ Inc. — 問い合わせフォーム受付 Worker（https://reyz.inc/api/contact）
   受付 → 検証 → Turnstile（ボット対策）→ Gmail API で ① contact@ へ控え ② 送信者へ受付確認。
   送信は Google Workspace のサービスアカウント（ドメイン全体の委任、scope gmail.send）で行う。
   依存ライブラリなし（WebCrypto + fetch）。秘密は Worker の secret（GMAIL_SA_KEY / GMAIL_SENDER_USER / TURNSTILE_SECRET_KEY）。 */

const PATH = '/api/contact';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const LIMITS = { name: 100, person: 100, email: 254, type: 100, message: 5000, turnstile: 2048, website: 200, body: 32 * 1024 };
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const REQUIRED_ENV = ['GMAIL_SA_KEY', 'GMAIL_SENDER_USER', 'TURNSTILE_SECRET_KEY', 'MAIL_TO', 'MAIL_FROM'];

export default {
  async fetch(request, env) {
    return handle(request, env, { fetch: (...a) => fetch(...a), now: () => Date.now() });
  }
};

/* ---------- 受付 ---------- */

export async function handle(request, env, deps) {
  const started = deps.now();
  const url = new URL(request.url);
  if (url.pathname !== PATH) return json({ ok: false, error: 'not_found' }, 404);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: baseHeaders({ Allow: 'POST, OPTIONS' }) });
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, { Allow: 'POST, OPTIONS' });

  const origins = allowedOrigins(env);
  const origin = request.headers.get('Origin') || '';
  if (!origins.includes(origin)) return json({ ok: false, error: 'origin' }, 403);

  const missing = REQUIRED_ENV.filter(k => !env[k]);
  if (missing.length) { log({ event: 'contact', ok: false, error: 'not_configured', missing }); return json({ ok: false, error: 'not_configured' }, 503); }

  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!ct.startsWith('application/json')) return json({ ok: false, error: 'content_type' }, 415);
  if (Number(request.headers.get('Content-Length') || 0) > LIMITS.body) return json({ ok: false, error: 'too_large' }, 413);
  const text = await request.text();
  if (text.length > LIMITS.body) return json({ ok: false, error: 'too_large' }, 413);
  let data;
  try { data = JSON.parse(text); } catch (err) { return json({ ok: false, error: 'json' }, 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ ok: false, error: 'json' }, 400);

  const { fields, errors } = validate(data);
  if (errors.length) return json({ ok: false, error: 'validation', fields: errors }, 400);
  if (fields.website) { log({ event: 'contact', ok: true, honeypot: true }); return json({ ok: true }); }   // ボット: 成功を装って捨てる

  const meta = { at: formatJst(deps.now()), country: request.headers.get('CF-IPCountry') || '', ray: request.headers.get('CF-Ray') || '' };
  const ts = await verifyTurnstile(deps, env.TURNSTILE_SECRET_KEY, fields.turnstile, request.headers.get('CF-Connecting-IP') || '', origins.map(o => new URL(o).hostname));
  if (!ts.ok) { log({ event: 'contact', ok: false, error: 'turnstile', codes: ts.codes, ray: meta.ray }); return json({ ok: false, error: 'turnstile', codes: ts.codes }, 403); }

  let token;
  try { token = await accessToken(deps, env); }
  catch (err) { log({ event: 'contact', ok: false, error: 'token', detail: String(err).slice(0, 300), ray: meta.ray }); return json({ ok: false, error: 'send', stage: 'token', detail: shortCode(String(err)) }, 502); }

  const copy = await gmailSend(deps, token, buildMime(copyMessage(env, fields, meta)));
  if (!copy.ok) { log({ event: 'contact', ok: false, error: 'send', status: copy.status, detail: copy.detail, ray: meta.ray }); return json({ ok: false, error: 'send', stage: 'copy', detail: shortCode(copy.detail) }, 502); }
  const confirmation = await gmailSend(deps, token, buildMime(confirmationMessage(env, fields, meta)));
  if (!confirmation.ok) log({ event: 'contact', ok: true, confirmation: false, status: confirmation.status, detail: confirmation.detail, ray: meta.ray });
  log({ event: 'contact', ok: true, confirmation: confirmation.ok, type: fields.type, country: meta.country, ray: meta.ray, ms: deps.now() - started });
  return json({ ok: true, confirmation: confirmation.ok });
}

/* ---------- 検証 ---------- */

export function validate(data) {
  const errors = []; const fields = {};
  const take = (key, { required = false, multiline = false } = {}) => {
    let v = data[key];
    if (v === undefined || v === null) v = '';
    if (typeof v !== 'string') { errors.push(key); fields[key] = ''; return; }
    v = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    if (!multiline) v = v.replace(/\n/g, ' ');
    v = v.trim();
    if ((required && !v) || v.length > LIMITS[key]) errors.push(key);
    fields[key] = v;
  };
  take('name', { required: true });
  take('person');
  take('email', { required: true });
  take('type', { required: true });
  take('message', { required: true, multiline: true });
  take('turnstile');
  take('website');
  if (fields.email && !errors.includes('email') && !EMAIL_RE.test(fields.email)) errors.push('email');
  return { fields, errors };
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

/* ---------- Turnstile ---------- */

async function verifyTurnstile(deps, secret, token, ip, hosts) {
  if (!token) return { ok: false, codes: ['missing-input-response'] };
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  let j;
  try {
    const res = await deps.fetch(TURNSTILE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    j = await res.json();
  } catch (err) { return { ok: false, codes: ['siteverify-unreachable'] }; }
  if (!j || j.success !== true) return { ok: false, codes: (j && j['error-codes']) || ['bad-response'] };
  if (j.hostname && hosts.length && !hosts.includes(j.hostname)) return { ok: false, codes: ['hostname-mismatch'] };
  return { ok: true };
}

/* ---------- Google: サービスアカウント → アクセストークン（ドメイン全体の委任で GMAIL_SENDER_USER になりすます） ---------- */

let tokenCache = { key: '', token: '', expMs: 0 };
export function resetTokenCache() { tokenCache = { key: '', token: '', expMs: 0 }; }

async function accessToken(deps, env) {
  const sa = JSON.parse(env.GMAIL_SA_KEY);
  if (!sa.client_email || !sa.private_key) throw new Error('GMAIL_SA_KEY: client_email / private_key がない');
  const key = sa.client_email + '|' + env.GMAIL_SENDER_USER;
  const now = deps.now();
  if (tokenCache.key === key && tokenCache.token && now < tokenCache.expMs - 60_000) return tokenCache.token;
  const assertion = await makeJwt(sa, env.GMAIL_SENDER_USER, now);
  const res = await deps.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`token endpoint ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  tokenCache = { key, token: j.access_token, expMs: now + (Number(j.expires_in) || 3600) * 1000 };
  return j.access_token;
}

export async function makeJwt(sa, sub, nowMs) {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, sub, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 };
  const input = b64url(utf8(JSON.stringify(header))) + '.' + b64url(utf8(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, utf8(input));
  return input + '.' + b64url(new Uint8Array(sig));
}

export function pemToDer(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/* ---------- Gmail API ---------- */

async function gmailSend(deps, token, mime) {
  try {
    const res = await deps.fetch(GMAIL_SEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(utf8(mime)) }) });
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, status: res.status, detail: t.slice(0, 300) }; }
    const j = await res.json().catch(() => ({}));
    return { ok: true, id: j.id || '' };
  } catch (err) { return { ok: false, status: 0, detail: String(err).slice(0, 300) }; }
}

/* ---------- メール本文 ---------- */

function copyMessage(env, f, meta) {
  const text = [
    '[REYZ お問い合わせ]',
    `受付: ${meta.at}`,
    `ご用件: ${f.type}`,
    `お名前: ${f.name}`,
    f.person ? `ご担当者様: ${f.person}` : null,
    `メール: ${f.email}`,
    '内容:',
    f.message,
    '',
    '--',
    `送信元: reyz.inc 問い合わせフォーム（国: ${meta.country || '-'} / Ray: ${meta.ray || '-'}）`,
    'このメールに返信すると送信者へ届きます。'
  ].filter(l => l !== null).join('\n');
  return { from: env.MAIL_FROM, to: env.MAIL_TO, replyTo: f.email, subject: `[REYZ お問い合わせ] ${f.type}｜${f.name}`, text };
}

function confirmationMessage(env, f, meta) {
  const text = [
    `${f.name} 様${f.person ? `（${f.person} 様）` : ''}`,
    '',
    'REYZ Inc.（株式会社レイズ）です。',
    'お問い合わせを受け付けました。内容を確認のうえ、担当者よりご連絡いたします。',
    '',
    '────────────────',
    `受付日時: ${meta.at}`,
    `ご用件: ${f.type}`,
    `お名前: ${f.name}`,
    f.person ? `ご担当者様: ${f.person}` : null,
    `メールアドレス: ${f.email}`,
    '内容:',
    f.message,
    '────────────────',
    '',
    'このメールは送信専用アドレスから自動送信しています。',
    `ご返信・追加のご連絡は ${addressOf(env.MAIL_TO)} へお願いします。`,
    '',
    'REYZ Inc.（株式会社レイズ）',
    'https://reyz.inc'
  ].filter(l => l !== null).join('\n');
  return { from: env.MAIL_FROM, to: f.email, replyTo: addressOf(env.MAIL_TO), subject: '【REYZ】お問い合わせを受け付けました', text };
}

/* ---------- MIME（text/plain; UTF-8; base64） ---------- */

export function buildMime({ from, to, replyTo, subject, text }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    fold(b64(utf8(text)), 76)
  ].filter(l => l !== null);
  return lines.join('\r\n');
}

// RFC 2047 encoded-word（各語 75 文字以下）。ASCII のみで短ければそのまま
export function encodeHeader(s) {
  if (/^[\x20-\x7e]*$/.test(s) && s.length <= 70) return s;
  const chars = Array.from(s); const words = [];
  for (let i = 0; i < chars.length; i += 11) words.push('=?UTF-8?B?' + b64(utf8(chars.slice(i, i + 11).join(''))) + '?=');
  return words.join('\r\n ');
}

export function addressOf(s) { const m = /<([^>]+)>/.exec(String(s)); return m ? m[1] : String(s).trim(); }

function fold(s, n) { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out.join('\r\n'); }

/* ---------- 小道具 ---------- */

export function formatJst(ms) {
  const d = new Date(ms + 9 * 3600 * 1000); const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} JST`;
}

const utf8 = s => new TextEncoder().encode(s);
export function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
export const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Google 側エラーの種別だけを短く返す（例: unauthorized_client = 委任未設定 / PERMISSION_DENIED = API 無効や権限）。本文・秘密は含めない
export function shortCode(s) {
  const t = String(s || '');
  const m = /"error"\s*:\s*"([A-Za-z_]+)"/.exec(t) || /"status"\s*:\s*"([A-Z_]+)"/.exec(t) || /"message"\s*:\s*"([^"]{1,80})"/.exec(t);
  return m ? m[1].slice(0, 80) : '';
}

function baseHeaders(extra = {}) {
  return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra };
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extra }) });
}
function log(obj) { try { console.log(JSON.stringify(obj)); } catch (err) { /* ignore */ } }
