// 送信専用ユーザー（no-reply@）の OAuth 同意を、人の転記なしで GitHub Secrets に反映するための処理（ADR-0008）。
// GitHub Actions（.github/workflows/oauth-consent.yml）から使う。人がやるのは「同意画面で許可」と「コードを 1 回貼る」だけ。
//
//   node infra/oauth/consent.mjs exchange   同意コード（`code~verifier`。PKCE）→ トークン。ID トークンで「誰が同意したか」を検証し、送信専用ユーザー本人でなければ
//                                          その場で新トークンを失効させて失敗（exit 3）。合格なら OUT_FILE にリフレッシュトークンを書く（値は表示しない）
//   node infra/oauth/consent.mjs revoke     TOKEN_FILE のリフレッシュトークンを失効させる（失効済みなら成功扱い）。注意: Google の失効は口座 × クライアントの
//                                          グラント単位で、同じ口座の他のトークン（新しいものも）が無効になる。通常の同意更新では使わない（漏えい時に全失効 → 再同意、の用途）
//   node infra/oauth/consent.mjs auth-url   同意 URL を組み立てて表示（受け取りページと同じ規則。手元確認用）
//
// 環境変数: GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, MAIL_SENDER_USER（例 no-reply@reyz.inc）, OAUTH_REDIRECT_URI, CODE, OUT_FILE, TOKEN_FILE
// 出力: 標準出力に JSON 1 行（email / hd / scope / expires_in など。トークンは含めない）。GitHub Actions では Summary にも書く。
import { readFileSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'];   // openid+email = ID トークンで同意した口座を検証するため
export const DEFAULT_REDIRECT = 'https://reyz.inc/oauth/callback.html';

export const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** PKCE（RFC 7636 / RFC 9700 で機密クライアントにも RECOMMENDED）: verifier は 43〜128 文字の [A-Za-z0-9-._~]、challenge は S256。 */
export function pkcePair(verifier = b64url(randomBytes(32))) {
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}
/** 受け取りページが表示する「同意コード」は `<code>~<verifier>`（1 回貼るだけで PKCE が成立する）。旧形式（code だけ）も受け付ける。 */
export function splitCode(input) {
  const s = String(input || '').trim();
  const i = s.indexOf('~');
  if (i < 0) return { code: s, verifier: '' };
  return { code: s.slice(0, i).trim(), verifier: s.slice(i + 1).trim() };
}

/** 同意 URL。受け取りページ（site/oauth/callback.html）が組み立てるものと同じ規則。 */
export function authUrl({ clientId, sender, redirectUri = DEFAULT_REDIRECT, state = '', challenge = '' }) {
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', login_hint: sender, hd: sender.split('@')[1] || '',
  });
  if (challenge) { p.set('code_challenge', challenge); p.set('code_challenge_method', 'S256'); }
  if (state) p.set('state', state);
  return AUTH_URL + '?' + p.toString();
}

/** ID トークン（JWT）の payload を読む。署名は検証しない: トークンは Google の token endpoint から TLS で直接受け取ったもの（OpenID Connect Core 3.1.3.7）。 */
export function decodeIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('id_token の形式が不正');
  return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

/** 同意した口座が送信専用ユーザー本人かを判定する。理由付きで返す（例外は投げない）。 */
export function verifyIdentity(claims, { clientId, sender, nowSec = Math.floor(Date.now() / 1000) }) {
  const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!issOk) return { ok: false, reason: `iss が Google ではない: ${claims.iss}` };
  if (claims.aud !== clientId) return { ok: false, reason: 'aud がこのクライアントではない' };
  if (Number(claims.exp) && Number(claims.exp) < nowSec - 300) return { ok: false, reason: 'id_token の期限切れ' };
  if (claims.email_verified !== true && claims.email_verified !== 'true') return { ok: false, reason: 'email_verified が true ではない' };
  const email = String(claims.email || '').toLowerCase();
  if (email !== String(sender).toLowerCase()) return { ok: false, reason: `同意した口座が ${email || '不明'}（期待: ${sender}）`, email };
  return { ok: true, email, hd: claims.hd || '' };
}

function form(body) { return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }; }

/** 失効。失効済み・無効なトークンは 400 invalid_token が返るが、後始末としては成功扱い。 */
export async function revoke(deps, token) {
  const res = await deps.fetch(REVOKE_URL, form({ token }));
  if (res.ok) return { ok: true, status: res.status };
  const j = await res.json().catch(() => ({}));
  if (res.status === 400 && j.error === 'invalid_token') return { ok: true, status: res.status, note: 'already invalid' };
  return { ok: false, status: res.status, error: j.error || '' };
}

/**
 * 同意コードをトークンに交換し、口座を検証する。
 * 返り値: { ok, email, hd, scope, expires_in, refreshToken? , reason? }。別の口座が同意したときだけ、受け取ったトークンを失効させてから返す（その口座のグラントのみ）。
 */
export async function exchange(deps, { code, clientId, clientSecret, sender, redirectUri = DEFAULT_REDIRECT }) {
  const { code: c, verifier } = splitCode(code);
  if (!c || !clientId || !clientSecret || !sender) throw new Error('CODE / GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / MAIL_SENDER_USER が必要');
  const body = { code: c, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' };
  if (verifier) body.code_verifier = verifier;   // PKCE。受け取りページ経由なら必ず付く
  const res = await deps.fetch(TOKEN_URL, form(body));
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: `token endpoint ${res.status}: ${j.error || ''} ${j.error_description || ''}`.trim() };
  if (!j.refresh_token) return { ok: false, reason: 'refresh_token が返らなかった（prompt=consent と access_type=offline の同意 URL から始めること）' };
  // 失効は「別の口座が同意した」ときだけ行う。Google の失効は口座 × クライアントのグラント単位なので、送信専用ユーザー本人のトークンを
  // 失効させると稼働中のトークンまで無効になる（2026-10-01 の事故）。口座が分からない・scope が足りないだけの場合は、保存せずに終える（トークンは残らない）
  let claims;
  try { claims = decodeIdToken(j.id_token); } catch (err) { return { ok: false, reason: String(err.message) + '（口座を特定できないため失効はしない）' }; }
  const v = verifyIdentity(claims, { clientId, sender, nowSec: Math.floor(deps.now() / 1000) });
  if (!v.ok) {
    const other = v.email && v.email !== String(sender).toLowerCase();   // 別の口座 → その口座のグラントを失効（本人のグラントには影響しない）
    const r = other ? await revoke(deps, j.refresh_token) : { ok: false };
    return { ok: false, reason: v.reason, email: v.email || '', revoked: other ? r.ok : false };
  }
  const scopes = String(j.scope || '').split(/\s+/);
  if (!scopes.includes('https://www.googleapis.com/auth/gmail.send')) return { ok: false, reason: `gmail.send が許可されていない（許可された scope: ${j.scope || '-'}）。同意画面で Gmail の送信にチェックを入れてやり直す（失効はしない）` };
  return { ok: true, email: v.email, hd: v.hd, scope: j.scope || '', expires_in: j.expires_in, refreshToken: j.refresh_token };
}

/* ---------- CLI ---------- */

function summary(md) { const f = process.env.GITHUB_STEP_SUMMARY; if (f) appendFileSync(f, md + '\n'); }
function notice(title, msg) { if (process.env.GITHUB_ACTIONS) console.log(`::notice title=${title}::${msg.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`); }
function fail(title, msg, code = 1) { if (process.env.GITHUB_ACTIONS) console.log(`::error title=${title}::${msg.replace(/%/g, '%25').replace(/\n/g, '%0A')}`); else console.error(msg); summary(`## ❌ ${title}\n\n${msg}`); process.exit(code); }

async function main() {
  const cmd = process.argv[2];
  const env = process.env;
  const deps = { fetch: (...a) => fetch(...a), now: () => Date.now() };
  const redirectUri = env.OAUTH_REDIRECT_URI || DEFAULT_REDIRECT;
  if (cmd === 'auth-url') {
    const pk = pkcePair();
    console.log(authUrl({ clientId: env.GMAIL_OAUTH_CLIENT_ID || '', sender: env.MAIL_SENDER_USER || '', redirectUri, challenge: pk.challenge }));
    console.error('code_verifier（交換時に code~verifier の形で渡す）: ' + pk.verifier);
    return;
  }
  if (cmd === 'exchange') {
    let r;
    try { r = await exchange(deps, { code: env.CODE, clientId: env.GMAIL_OAUTH_CLIENT_ID, clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET, sender: env.MAIL_SENDER_USER, redirectUri }); }
    catch (err) { fail('oauth-consent', String(err.message || err), 2); }
    const info = { ok: r.ok, email: r.email || '', hd: r.hd || '', scope: r.scope || '', expires_in: r.expires_in, reason: r.reason || '', revoked: r.revoked };
    if (env.RESULT_JSON) writeFileSync(env.RESULT_JSON, JSON.stringify(info));
    console.log(JSON.stringify(info));
    if (!r.ok) fail('oauth-consent: 同意を保存しませんでした', r.reason + (r.revoked ? `\n別の口座のトークンは失効させました。${env.MAIL_SENDER_USER} でログインし直して同意してください` : ''), 3);
    if (!env.OUT_FILE) fail('oauth-consent', 'OUT_FILE が未設定', 2);
    writeFileSync(env.OUT_FILE, r.refreshToken, { mode: 0o600 }); chmodSync(env.OUT_FILE, 0o600);
    notice('oauth-consent', `同意した口座: ${r.email}（hd=${r.hd}） scope=${r.scope}`);
    summary(`## ✅ 同意を検証しました\n\n| 項目 | 値 |\n|---|---|\n| 同意した口座 | ${r.email} |\n| ドメイン | ${r.hd || '-'} |\n| 許可された scope | ${r.scope} |\n\nリフレッシュトークンは GitHub Secret \`GMAIL_OAUTH_REFRESH_TOKEN\` へ（値は記録に残さない）。`);
    return;
  }
  if (cmd === 'revoke') {
    const token = env.TOKEN_FILE ? readFileSync(env.TOKEN_FILE, 'utf8').trim() : '';
    if (!token) { console.log(JSON.stringify({ skipped: true, note: 'no token' })); return; }
    const newToken = env.NEW_TOKEN_FILE ? readFileSync(env.NEW_TOKEN_FILE, 'utf8').trim() : '';
    if (newToken && newToken === token) { console.log(JSON.stringify({ skipped: true, note: 'same as new' })); return; }
    const r = await revoke(deps, token);
    console.log(JSON.stringify(r));
    if (!r.ok) fail('oauth-consent: 古いトークンの失効に失敗', `status ${r.status} ${r.error}`, 4);
    notice('oauth-consent', '古いリフレッシュトークンを失効させました' + (r.note ? `（${r.note}）` : ''));
    return;
  }
  console.error('usage: consent.mjs exchange | revoke | auth-url'); process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
