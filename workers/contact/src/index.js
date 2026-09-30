/* REYZ Inc. — 問い合わせフォーム受付 Worker（https://reyz.inc/api/contact）
   受付 → 検証 → honeypot → レート制限 → Turnstile（ボット対策）→ Gmail API で ① contact@ へ控え ② 送信者へ受付確認。
   送信は Google Workspace の送信専用ユーザー（no-reply@）本人の OAuth 同意（scope gmail.send）で行う（ADR-0007）。

   多層防御（送信者の環境に依存しない）:
   - Turnstile が読めない環境（拡張機能・企業ネットワーク等）や照合失敗でも、UNVERIFIED_POLICY=accept-flagged なら
     「未検証」として受け付ける（控えの件名に [未検証]、送信者への確認メールは送らない＝なりすまし宛先への自動返信を避ける）。
   - 全経路にレート制限（CONTACT_RL binding、同一 IP）、honeypot、内容の簡易ヒューリスティック。
   - dry_run=true は照合まで、dry_run="token" は Google のトークン取得までを行い、どちらも送信しない（通し確認用）。
   依存ライブラリなし（fetch のみ）。秘密は Worker の secret（GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN / TURNSTILE_SECRET_KEY）。
   secret の正本は GitHub Secrets（.github/workflows/contact-worker.yml が配備のたびに宣言的に同期する）。 */

const PATH = '/api/contact';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const LIMITS = { name: 100, person: 100, email: 254, type: 100, message: 5000, turnstile: 2048, website: 200, client: 120, body: 32 * 1024 };
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const REQUIRED_ENV = ['TURNSTILE_SECRET_KEY', 'MAIL_TO', 'MAIL_FROM', 'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN'];

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

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const meta = { at: formatJst(deps.now()), country: request.headers.get('CF-IPCountry') || '', ray: request.headers.get('CF-Ray') || '', client: fields.client };
  const rl = await rateLimit(env, ip);
  if (!rl.ok) { log({ event: 'contact', ok: false, error: 'rate_limited', ray: meta.ray }); return json({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '60' }); }

  // Turnstile: トークンがあれば照合。無い／不合格なら方針に従う（accept-flagged = 未検証で受付、reject = 拒否）
  let verified = false, codes = ['missing-input-response'];
  // siteverify が返す hostname（ウィジェットが解かれたサイト）は、既定では許可 origin のホスト名と一致を要求。CI（公式テストキーは example.com を返す）は TURNSTILE_HOSTNAMES で上書き
  const hosts = String(env.TURNSTILE_HOSTNAMES || '').split(',').map(x => x.trim()).filter(Boolean);
  if (fields.turnstile) { const ts = await verifyTurnstile(deps, env.TURNSTILE_SECRET_KEY, fields.turnstile, ip, hosts.length ? hosts : origins.map(o => new URL(o).hostname)); verified = ts.ok; codes = ts.ok ? [] : ts.codes; }
  // honeypot（隠しフィールド）に値がある: 人（Turnstile 検証済み）ならブラウザの自動入力とみなして受け付け（控えに注記）、ボット（未検証）は成功を装って捨てる
  const honeypot = !!fields.website;
  if (honeypot && !verified) { log({ event: 'contact', ok: true, honeypot: true, dropped: true, codes, client: meta.client, ray: meta.ray }); return json({ ok: true }); }
  if (!verified) {
    const reason = unverifiedReject(fields, env.UNVERIFIED_POLICY);
    if (reason) { log({ event: 'contact', ok: false, error: reason, codes, client: meta.client, ray: meta.ray }); return json({ ok: false, error: reason, codes }, 403); }
  }
  if (fields.dry_run === 'verify') return json({ ok: true, dry_run: true, verified, codes, client: meta.client, rate_limit: rl.skipped ? 'skipped' : 'ok' });

  try { await accessToken(deps, env); }
  catch (err) {
    log({ event: 'contact', ok: false, error: 'token', detail: String(err).slice(0, 300), dry_run: fields.dry_run || undefined, ray: meta.ray });
    if (fields.dry_run === 'token') return json({ ok: true, dry_run: true, verified, codes, client: meta.client, rate_limit: rl.skipped ? 'skipped' : 'ok', google_token: false, detail: shortCode(String(err)) });
    return json({ ok: false, error: 'send', stage: 'token', detail: shortCode(String(err)) }, 502);
  }
  if (fields.dry_run === 'token') return json({ ok: true, dry_run: true, verified, codes, client: meta.client, rate_limit: rl.skipped ? 'skipped' : 'ok', google_token: true });

  const copy = await gmailSend(deps, env, buildMime(copyMessage(env, fields, meta, verified, codes, honeypot)));
  if (!copy.ok) { log({ event: 'contact', ok: false, error: 'send', stage: copy.stage || 'copy', status: copy.status, detail: copy.detail, ray: meta.ray }); return json({ ok: false, error: 'send', stage: copy.stage || 'copy', detail: shortCode(copy.detail) }, 502); }
  let confirmation = { ok: false, id: '' };
  if (verified) {   // 送信者への確認メールは、送信者が実在の人であることが確認できたときだけ（未確認の宛先へ自動返信しない）
    confirmation = await gmailSend(deps, env, buildMime(confirmationMessage(env, fields, meta)));
    if (!confirmation.ok) log({ event: 'contact', ok: true, confirmation: false, status: confirmation.status, detail: confirmation.detail, ray: meta.ray });
  }
  // gmail_copy / gmail_confirmation = Gmail が受理して「送信済み」に保存したメッセージ ID（送達の一次証拠）
  log({ event: 'contact', ok: true, verified, codes, client: meta.client, honeypot, confirmation: confirmation.ok, gmail_copy: copy.id, gmail_confirmation: confirmation.id || '', auth: authMode(env), type: fields.type, country: meta.country, ray: meta.ray, ms: deps.now() - started });
  return json({ ok: true, verified, confirmation: confirmation.ok });
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
  // 診断情報（フォーム側の Turnstile 状態）と dry_run は任意。型が違っても拒否せず無視する
  const c = data.client && typeof data.client === 'object' && typeof data.client.turnstile === 'string' ? data.client.turnstile : '';
  fields.client = c.replace(/[^\x20-\x7e]/g, '').slice(0, LIMITS.client);
  fields.dry_run = data.dry_run === true ? 'verify' : (data.dry_run === 'token' ? 'token' : '');   // verify = 照合まで / token = Google のトークン取得まで（送信しない）
  return { fields, errors };
}

// 未検証（Turnstile 無し／不合格）の送信を受け付けるか。null = 受け付ける、文字列 = 拒否理由
export function unverifiedReject(fields, policy) {
  if ((policy || 'accept-flagged') !== 'accept-flagged') return 'turnstile';
  const links = (fields.message.match(/https?:\/\/|www\./gi) || []).length;
  if (links > 2) return 'suspicious';
  if (/https?:\/\/|www\./i.test(fields.name + ' ' + fields.person)) return 'suspicious';
  return null;
}

// 同一 IP のレート制限（wrangler.toml の [[ratelimits]] CONTACT_RL）。binding が無い環境（テスト等）では通す
async function rateLimit(env, ip) {
  if (!env.CONTACT_RL || !ip) return { ok: true, skipped: true };
  try { const r = await env.CONTACT_RL.limit({ key: ip }); return { ok: r && r.success !== false, skipped: false }; }
  catch (err) { log({ event: 'contact', warn: 'ratelimit_error', detail: String(err).slice(0, 200) }); return { ok: true, skipped: true }; }
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

/* ---------- Google: アクセストークン（送信の認証 adapter） ----------
   oauth: 送信専用ユーザー（no-reply@）本人の OAuth 同意で得たリフレッシュトークン → アクセストークン（refresh_token grant）。
          鍵が漏れても影響は「そのユーザーの送信」だけ（ADR-0007）。失効（取り消し・パスワード変更・6 か月未使用）は
          token endpoint の invalid_grant として現れ、502 `send/token` → contact-watch が noc@ へ通知する。
   authMode() は将来の adapter 追加（別の送信事業者など）のための識別子。現在は 'oauth' のみ。 */

export function authMode(env) {
  if (env.GMAIL_OAUTH_CLIENT_ID && env.GMAIL_OAUTH_CLIENT_SECRET && env.GMAIL_OAUTH_REFRESH_TOKEN) return 'oauth';
  return null;
}

let tokenCache = { key: '', token: '', expMs: 0 };
export function resetTokenCache() { tokenCache = { key: '', token: '', expMs: 0 }; }

export async function accessToken(deps, env) {
  if (!authMode(env)) throw new Error('送信の認証情報がない（GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN）');
  const now = deps.now();
  // cache の鍵にリフレッシュトークン末尾を含め、トークンを差し替えたときに古いアクセストークンを使い続けない
  const key = 'oauth|' + env.GMAIL_OAUTH_CLIENT_ID + '|' + String(env.GMAIL_OAUTH_REFRESH_TOKEN).slice(-6);
  if (tokenCache.key === key && tokenCache.token && now < tokenCache.expMs - 60_000) return tokenCache.token;
  const body = { grant_type: 'refresh_token', client_id: env.GMAIL_OAUTH_CLIENT_ID, client_secret: env.GMAIL_OAUTH_CLIENT_SECRET, refresh_token: env.GMAIL_OAUTH_REFRESH_TOKEN };
  const res = await deps.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`token endpoint ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  tokenCache = { key, token: j.access_token, expMs: now + (Number(j.expires_in) || 3600) * 1000 };
  return j.access_token;
}

/* ---------- Gmail API ---------- */

// 401（アクセストークンが途中で失効: リフレッシュトークンのローテーション直後など）は cache を捨てて 1 回だけ取り直す
async function gmailSend(deps, env, mime, retried = false) {
  let token;
  try { token = await accessToken(deps, env); } catch (err) { return { ok: false, status: 0, stage: 'token', detail: String(err).slice(0, 300) }; }
  try {
    const res = await deps.fetch(GMAIL_SEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(utf8(mime)) }) });
    if (res.status === 401 && !retried) { resetTokenCache(); return gmailSend(deps, env, mime, true); }
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, status: res.status, detail: t.slice(0, 300) }; }
    const j = await res.json().catch(() => ({}));
    return { ok: true, id: j.id || '' };
  } catch (err) { return { ok: false, status: 0, detail: String(err).slice(0, 300) }; }
}

/* ---------- メール本文 ---------- */

function copyMessage(env, f, meta, verified, codes, honeypot) {
  const text = [
    verified ? '[REYZ お問い合わせ]' : '[REYZ お問い合わせ]（未検証: ボット対策の照合なし。差出人アドレスは未確認のため、返信前に内容を確認してください）',
    honeypot ? '（注: 隠しフィールドに値が入っていました。ブラウザの自動入力の可能性が高いですが、内容を確認してください）' : null,
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
    `ボット対策: ${verified ? '検証済み' : '未検証'}${verified ? '' : `（form: ${meta.client || '-'} / siteverify: ${(codes || []).join(',') || '-'}）`}`,
    'このメールに返信すると送信者へ届きます。'
  ].filter(l => l !== null).join('\n');
  return { from: env.MAIL_FROM, to: env.MAIL_TO, replyTo: f.email, subject: `${verified ? '' : '[未検証] '}[REYZ お問い合わせ] ${f.type}｜${f.name}`, text };
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

// Google 側エラーの種別だけを短く返す（例: invalid_grant = 同意の失効 / invalid_client = クライアント ID・シークレット不正 / PERMISSION_DENIED = API 無効や権限）。本文・秘密は含めない
export function shortCode(s) {
  const t = String(s || '');
  const m = /"error"\s*:\s*"([A-Za-z_]+)"/.exec(t) || /"status"\s*:\s*"([A-Z_]+)"/.exec(t) || /"message"\s*:\s*"([^"]{1,80})"/.exec(t);
  if (m) return m[1].slice(0, 80);
  return t.replace(/[{}"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);   // JSON でない失敗（鍵の形式不備など）は先頭だけ
}

function baseHeaders(extra = {}) {
  return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra };
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extra }) });
}
function log(obj) { try { console.log(JSON.stringify(obj)); } catch (err) { /* ignore */ } }
