// 前提の検査（何も変更しない）。運用 workflow（oauth-consent / turnstile-rotate / contact-worker / contact-watch）が
// 動くための Secret・変数・外部設定を、一括で PASS / FAIL / SKIP に判定する。.github/workflows/ops-check.yml から使う。
//
//   node infra/ops/check.mjs        環境変数から読み、判定表を標準出力（JSON 1 行）・Summary・annotation・REPORT_FILE（任意、平文）に出す。FAIL が 1 つでもあれば exit 1
//
// 検査項目（番号は Summary と同じ）:
//   C1 Secret / 変数の有無と形式             C2 Cloudflare トークン（Turnstile 回転用）の有効性と権限（ウィジェットを読めるか）
//   C3 Cloudflare トークン（Workers 配備用）  C4 Turnstile 秘密キー（siteverify に偽トークンを送り、鍵が有効かだけ見る）
//   C5 OAuth クライアントとリダイレクト URI（Google の認可 endpoint が受け付けるか。ログインは要らない。エラーは転送先 URL で判定。PROBE_REDIRECT_URI で反証: 未登録の URI なら FAIL になるのが正しい）
//   C6 OAuth クライアント シークレット（token endpoint に偽コードを送る。invalid_grant なら認証は通っている）
//   C7 リフレッシュトークン（refresh で access token が取れるか。openid を含む同意なら「同意した口座」も判定）
//   C8 GitHub App「REYZ Ops」（秘密鍵と App ID の一致、インストール先の repo、権限 Actions/Secrets/Issues: write）
//   C9 受け取りページ https://reyz.inc/oauth/callback.html（公開の clientId / sender が Secret・変数と一致するか）
// 秘密の値は一切出力しない（判定と、公開値だけ）。偽コード・偽トークンを送る検査は、相手側に何も作らない。
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { createSign, createPrivateKey } from 'node:crypto';

export const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const CF = 'https://api.cloudflare.com/client/v4';
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const GH = 'https://api.github.com';
export const DEFAULT_REDIRECT = 'https://reyz.inc/oauth/callback.html';
export const REQUIRED_APP_PERMISSIONS = { actions: 'write', secrets: 'write', issues: 'write', metadata: 'read' };

const item = (id, name, status, detail, next = '') => ({ id, name, status, detail, next });
const PASS = 'PASS', FAIL = 'FAIL', SKIP = 'SKIP';
const safeJson = async res => { try { return await res.json(); } catch { return {}; } };
const short = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

/** 公開ファイル site/assets/site.js から Turnstile のサイトキー（公開値）を読む。 */
export function readSiteKey(siteJs) {
  const m = /turnstileSiteKey:\s*'([^']+)'/.exec(siteJs || '');
  return m ? m[1] : '';
}

/** GitHub App の JWT（RS256、有効 9 分）。秘密鍵は PKCS#1 / PKCS#8 の PEM。 */
export function appJwt(appId, pem, nowSec = Math.floor(Date.now() / 1000)) {
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: /^\d+$/.test(String(appId)) ? Number(appId) : String(appId) }));   // App ID は数値、Client ID は文字列
  const sig = createSign('RSA-SHA256').update(`${h}.${p}`).sign(createPrivateKey(pem));
  return `${h}.${p}.${b64url(sig)}`;
}

/* ---------- 個別の検査。すべて deps.fetch 経由で、例外は投げずに FAIL にする ---------- */

export async function checkPresence(env) {
  const secrets = ['CLOUDFLARE_TURNSTILE_TOKEN', 'CLOUDFLARE_WORKERS_TOKEN', 'TURNSTILE_SECRET_KEY', 'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN', 'OPS_APP_PRIVATE_KEY'];
  const vars = { OPS_APP_ID: /^\d+$/, MAIL_SENDER_USER: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, CLOUDFLARE_ACCOUNT_ID: /^[0-9a-f]{32}$/, NOC_EMAIL: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ };
  const missing = secrets.filter(k => !env[k]);
  const bad = [];
  for (const [k, re] of Object.entries(vars)) { if (!env[k]) missing.push(`vars.${k}`); else if (!re.test(env[k])) bad.push(`vars.${k}=${env[k]}`); }
  const ok = missing.length === 0 && bad.length === 0;
  const shown = Object.keys(vars).filter(k => env[k]).map(k => `${k}=${env[k]}`).join(', ');
  return item('C1', 'Secret / 変数の有無と形式', ok ? PASS : FAIL,
    (ok ? '全て設定済み' : [missing.length ? `未設定: ${missing.map(k => k.startsWith('vars.') ? k : `secrets.${k}`).join(', ')}` : '', bad.length ? `形式が不正: ${bad.join(', ')}` : ''].filter(Boolean).join(' / ')) + (shown ? `（${shown}）` : ''),
    ok ? '' : 'workers/contact/README.md「前提」の表のとおりに登録する');
}

export async function checkCloudflareToken(deps, { token, label, accountId, siteKey, id, needWidget }) {
  if (!token) return item(id, label, SKIP, 'Secret が未設定', 'README「前提」');
  const res = await deps.fetch(`${CF}/user/tokens/verify`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await safeJson(res);
  if (!res.ok || !j.success) return item(id, label, FAIL, `トークンが無効（HTTP ${res.status} ${short(JSON.stringify(j.errors || ''))}）`, 'Cloudflare → プロフィール → API トークンで作り直し、Secret を上書き');
  const st = j.result?.status, exp = j.result?.expires_on;
  if (st !== 'active') return item(id, label, FAIL, `トークンの状態が ${st}`, 'Cloudflare でトークンを有効化するか作り直す');
  let detail = `有効（status=active${exp ? `、期限 ${exp}` : '、期限なし'}）`;
  if (needWidget) {
    if (!accountId || !siteKey) return item(id, label, FAIL, `${detail}。ウィジェット確認に必要な値が無い（account=${accountId ? 'あり' : '無し'}, sitekey=${siteKey ? 'あり' : '無し'}）`, 'vars.CLOUDFLARE_ACCOUNT_ID と site/assets/site.js の turnstileSiteKey');
    const w = await deps.fetch(`${CF}/accounts/${accountId}/challenges/widgets/${siteKey}`, { headers: { Authorization: `Bearer ${token}` } });
    const wj = await safeJson(w);
    if (!w.ok || !wj.success) return item(id, label, FAIL, `${detail}。しかし Turnstile ウィジェットを読めない（HTTP ${w.status} ${short(JSON.stringify(wj.errors || ''))}）`, '権限「アカウント | Turnstile | 編集」と、アカウント リソースが REYZ のアカウントかを確認');
    detail += `。ウィジェット ${wj.result?.name || siteKey}（domains: ${(wj.result?.domains || []).join(', ') || '-'}）を読めた`;
  }
  return item(id, label, PASS, detail);
}

export async function checkTurnstileSecret(deps, { secret }) {
  const id = 'C4', label = 'Turnstile 秘密キー';
  if (!secret) return item(id, label, SKIP, 'Secret が未設定');
  const body = new URLSearchParams({ secret, response: 'ops-check-probe' }).toString();
  const res = await deps.fetch(TURNSTILE_VERIFY, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await safeJson(res);
  const codes = j['error-codes'] || [];
  if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) return item(id, label, FAIL, `siteverify が鍵を拒否（${codes.join(', ')}）`, 'Cloudflare → Turnstile → ウィジェットの秘密キーを Secret TURNSTILE_SECRET_KEY へ。以後は turnstile-rotate が回転');
  if (j.success === true) return item(id, label, PASS, '鍵は有効（偽トークンが success=true になった: テスト用の鍵の可能性）');
  if (codes.includes('invalid-input-response') || codes.includes('timeout-or-duplicate')) return item(id, label, PASS, `鍵は有効（偽トークンは想定どおり拒否: ${codes.join(', ')}）`);
  return item(id, label, FAIL, `判定できない応答（HTTP ${res.status} ${short(JSON.stringify(j))}）`, '時間を置いて再実行。続くなら Cloudflare の状態を確認');
}

/** Google の認可 endpoint のエラーページ（/signin/oauth/error?authError=...）から error code を取り出す。authError は base64 のバイナリで、中に "redirect_uri_mismatch" 等の文字列を含む。 */
export function decodeAuthError(url) {
  try {
    const e = new URL(url).searchParams.get('authError');
    if (!e) return '';
    const bin = Buffer.from(e.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    const m = /[a-z][a-z_]{5,}/.exec(bin);
    return m ? m[0] : '';
  } catch { return ''; }
}
const pathOf = u => { try { const x = new URL(u); return x.host + x.pathname; } catch { return String(u).slice(0, 80); } };
const SIGNIN_RE = /identifier|\/signin|ServiceLogin|accountchooser|oauthchooseaccount/i;
const OAUTH_ERROR_RE = /\/signin\/oauth\/error|\/oauth\/error/i;

/**
 * C5: Google の認可 endpoint が「このクライアント ID ＋ このリダイレクト URI」を受け付けるか。ログインはしない。
 * Google は未登録 URI などのエラーを、本文ではなく /signin/oauth/error への転送（302）で返す（2026-10-01 の実 run で確認。本文だけ見ると誤って PASS になる）。
 * そのため転送先の URL を最大 5 回追い、エラーページなら FAIL、ログイン画面に着けば PASS、どちらでもなければ FAIL（判定できない）にする。
 */
export async function checkOAuthClientAuthz(deps, { clientId, redirectUri, probe = false }) {
  const id = 'C5', label = 'OAuth クライアントとリダイレクト URI' + (probe ? `（反証モード: ${redirectUri} で実行）` : '');
  if (!clientId) return item(id, label, SKIP, 'GMAIL_OAUTH_CLIENT_ID が未設定');
  const nextAction = 'GCP → Google Auth Platform → クライアント reyz-mail-sender → 承認済みのリダイレクト URI に追加 → 保存（反映に 5 分〜数時間。README「同意の自動化の前提」1）';
  const judge = (url, text) => {
    const code = OAUTH_ERROR_RE.test(url) ? (decodeAuthError(url) || 'unknown') : (/redirect_uri_mismatch/i.test(text) ? 'redirect_uri_mismatch' : /invalid_client/i.test(text) ? 'invalid_client' : '');
    if (code === 'redirect_uri_mismatch') return item(id, label, FAIL, `Google が redirect_uri_mismatch: ${redirectUri} が「承認済みのリダイレクト URI」に無い`, nextAction);
    if (code === 'invalid_client') return item(id, label, FAIL, 'Google が invalid_client: クライアント ID が見つからない', 'Secret GMAIL_OAUTH_CLIENT_ID と GCP のクライアント ID を照合');
    if (code) return item(id, label, FAIL, `Google がエラーページへ転送（${code}）`, 'エラーの種類に応じて GCP のクライアント設定を確認');
    return null;
  };
  let url = `${GOOGLE_AUTH}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid' })}`;
  const hops = [];
  for (let i = 0; i < 6; i++) {
    const res = await deps.fetch(url, { redirect: 'manual', headers: { 'Accept-Language': 'ja,en' } });
    const isRedirect = res.status >= 300 && res.status < 400;
    const text = isRedirect ? '' : await res.text().catch(() => '');
    hops.push(`${res.status} ${pathOf(url)}`);
    const bad = judge(url, text);
    if (bad) return bad;
    if (isRedirect) {
      const loc = res.headers.get('location');
      if (!loc) return item(id, label, FAIL, `転送先が無い（HTTP ${res.status}）`, '時間を置いて再実行');
      url = new URL(loc, url).toString();
      const badLoc = judge(url, '');
      if (badLoc) return badLoc;
      if (SIGNIN_RE.test(url)) return item(id, label, PASS, `認可 endpoint が受け付け、ログイン画面へ転送（${pathOf(url)}）: リダイレクト URI ${redirectUri} は登録済み`);
      continue;
    }
    if (res.ok && (SIGNIN_RE.test(url) || /identifier|ServiceLogin/i.test(text))) return item(id, label, PASS, `認可 endpoint が受け付け、ログイン画面を表示（${pathOf(url)}）: リダイレクト URI ${redirectUri} は登録済み`);
    return item(id, label, FAIL, `判定できない応答（${hops.join(' → ')}）`, '時間を置いて再実行。続くなら IV が判定方法を見直す');
  }
  return item(id, label, FAIL, `転送が多すぎる（${hops.join(' → ')}）`, '時間を置いて再実行');
}

export async function checkOAuthClientSecret(deps, { clientId, clientSecret, redirectUri }) {
  const id = 'C6', label = 'OAuth クライアント シークレット';
  if (!clientId || !clientSecret) return item(id, label, SKIP, 'GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET が未設定');
  const body = new URLSearchParams({ code: 'ops-check-probe', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString();
  const res = await deps.fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await safeJson(res);
  if (j.error === 'invalid_client') return item(id, label, FAIL, `token endpoint が invalid_client（${short(j.error_description)}）: ID かシークレットが違う`, 'GCP のクライアントで「シークレットを追加」→ 新しい値を Secret GMAIL_OAUTH_CLIENT_SECRET に上書き → 古いものを無効化');
  if (j.error === 'invalid_grant') return item(id, label, PASS, 'クライアント認証は通っている（偽コードは想定どおり invalid_grant）');
  return item(id, label, FAIL, `判定できない応答（HTTP ${res.status} ${short(JSON.stringify(j))}）`, '時間を置いて再実行');
}

export async function checkRefreshToken(deps, { clientId, clientSecret, refreshToken, sender }) {
  const id = 'C7', label = 'リフレッシュトークン（送信の鍵）';
  if (!clientId || !clientSecret || !refreshToken) return item(id, label, SKIP, 'クライアントかリフレッシュトークンが未設定');
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString();
  const res = await deps.fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await safeJson(res);
  if (!res.ok || !j.access_token) return item(id, label, FAIL, `refresh できない（HTTP ${res.status} ${j.error || ''} ${short(j.error_description)}）: 失効・取り消し・別クライアントの可能性`, '受け取りページから同意をやり直す（README 設定手順 7〜8。oauth-consent が Secret を更新）');
  const scopes = String(j.scope || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes('https://www.googleapis.com/auth/gmail.send')) return item(id, label, FAIL, `gmail.send が無い（scope: ${scopes.join(' ') || '-'}）`, '同意をやり直す（README 設定手順 7〜8）');
  let who = '同意した口座は不明（openid/email を含まない旧い同意。oauth-consent で更新すると判定できる）';
  if (j.id_token) {
    try {
      const claims = JSON.parse(Buffer.from(String(j.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      const email = String(claims.email || '').toLowerCase();
      if (sender && email !== String(sender).toLowerCase()) return item(id, label, FAIL, `同意した口座が ${email}（期待: ${sender}）`, `${sender} でログインして同意をやり直す（README 設定手順 7〜8）`);
      who = `同意した口座: ${email || '不明'}`;
    } catch { who = 'id_token を読めなかった'; }
  }
  return item(id, label, PASS, `有効（scope: ${scopes.map(s => s.replace('https://www.googleapis.com/auth/', '')).join(' ')}）。${who}`);
}

export async function checkGitHubApp(deps, { appId, pem, owner, repo, nowSec }) {
  const id = 'C8', label = 'GitHub App「REYZ Ops」';
  if (!appId || !pem) return item(id, label, SKIP, 'vars.OPS_APP_ID / secrets.OPS_APP_PRIVATE_KEY が未設定', 'README「同意の自動化の前提」の GitHub App の表');
  let jwt;
  try { jwt = appJwt(appId, pem, nowSec); } catch (err) { return item(id, label, FAIL, `秘密鍵を読めない（${short(err.message)}）`, '.pem の全文（BEGIN〜END）を Secret OPS_APP_PRIVATE_KEY に貼り直す'); }
  const H = { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' };
  const app = await deps.fetch(`${GH}/app`, { headers: H });
  const aj = await safeJson(app);
  if (!app.ok) return item(id, label, FAIL, `App の認証に失敗（HTTP ${app.status} ${short(aj.message)}）: App ID と秘密鍵が一致しない`, 'App の設定画面の App ID を vars.OPS_APP_ID に、Generate a private key で作った .pem を Secret に（古い鍵は削除）');
  const inst = await deps.fetch(`${GH}/app/installations`, { headers: H });
  const list = await safeJson(inst);
  const mine = Array.isArray(list) ? list.find(i => String(i.account?.login || '').toLowerCase() === owner.toLowerCase()) : null;
  if (!mine) return item(id, label, FAIL, `App「${aj.slug || aj.name}」は ${owner} にインストールされていない`, 'App の設定画面 → Install App → Only select repositories → reyz-site → Install（README の表 6）');
  const lacking = Object.entries(REQUIRED_APP_PERMISSIONS).filter(([k, need]) => { const got = mine.permissions?.[k]; return !(got === need || (need === 'read' && got === 'write')); }).map(([k, need]) => `${k}:${need}（現在 ${mine.permissions?.[k] || '無し'}）`);
  if (lacking.length) return item(id, label, FAIL, `インストール済みだが権限が足りない: ${lacking.join(', ')}`, 'App の Permissions を Actions/Secrets/Issues: Read and write に → Install App で権限の更新を承認');
  const tok = await deps.fetch(`${GH}/app/installations/${mine.id}/access_tokens`, { method: 'POST', headers: H });
  const tj = await safeJson(tok);
  if (!tok.ok || !tj.token) return item(id, label, FAIL, `インストール トークンを作れない（HTTP ${tok.status} ${short(tj.message)}）`, 'App のインストール状態を確認');
  const repos = await deps.fetch(`${GH}/installation/repositories?per_page=100`, { headers: { Authorization: `Bearer ${tj.token}`, Accept: 'application/vnd.github+json' } });
  const rj = await safeJson(repos);
  const names = (rj.repositories || []).map(r => r.full_name.toLowerCase());
  if (mine.repository_selection !== 'all' && !names.includes(`${owner}/${repo}`.toLowerCase())) return item(id, label, FAIL, `インストール先に ${owner}/${repo} が無い（${names.join(', ') || '無し'}）`, 'App の Install App → Configure → Only select repositories に reyz-site を追加');
  return item(id, label, PASS, `App「${aj.slug || aj.name}」（id ${aj.id}）: ${owner}/${repo} にインストール済み。権限 ${Object.entries(REQUIRED_APP_PERMISSIONS).map(([k, v]) => `${k}:${v}`).join(' ')} あり`);
}

export async function checkCallbackPage(deps, { url, clientId, sender, repository }) {
  const id = 'C9', label = '受け取りページ（公開値の一致）';
  const res = await deps.fetch(url, { headers: { 'User-Agent': 'reyz-ops-check (+https://github.com/REYZ-Inc/reyz-site)' } }).catch(() => null);
  if (!res || !res.ok) return item(id, label, FAIL, `${url} を取得できない（HTTP ${res ? res.status : '-'}）`, 'サイトの配備（verify-and-deploy）と Cloudflare を確認');
  const text = await res.text().catch(() => '');
  const pageClient = (/clientId:\s*'([^']*)'/.exec(text) || [])[1] || '';
  const pageSender = (/sender:\s*'([^']*)'/.exec(text) || [])[1] || '';
  const pageWf = (/workflowUrl:\s*'([^']*)'/.exec(text) || [])[1] || '';
  const bad = [];
  if (clientId && pageClient !== clientId) bad.push('clientId が Secret GMAIL_OAUTH_CLIENT_ID と不一致');
  if (sender && pageSender.toLowerCase() !== String(sender).toLowerCase()) bad.push(`sender が vars.MAIL_SENDER_USER と不一致（ページ: ${pageSender}）`);
  if (repository && !pageWf.includes(`/${repository}/`)) bad.push(`workflowUrl が ${repository} を指していない`);
  if (bad.length) return item(id, label, FAIL, bad.join(' / '), 'site/oauth/callback.html の CONFIG（公開値）を直して PR');
  return item(id, label, PASS, `ページの clientId / sender（${pageSender}）/ workflowUrl が Secret・変数・repo と一致`);
}

/* ---------- まとめて実行 ---------- */

export async function runAll(deps, env) {
  const redirectUri = env.OAUTH_REDIRECT_URI || DEFAULT_REDIRECT;
  const [owner, repo] = String(env.GITHUB_REPOSITORY || 'REYZ-Inc/reyz-site').split('/');
  const siteKey = readSiteKey(deps.readFile ? deps.readFile('site/assets/site.js') : '');
  const items = [];
  const run = async p => { try { items.push(await p); } catch (err) { items.push(item('C?', '検査の実行', FAIL, `例外: ${short(err.message)}`, '再実行。続くなら IV に報告')); } };
  await run(checkPresence(env));
  await run(checkCloudflareToken(deps, { id: 'C2', label: 'Cloudflare トークン（Turnstile 回転用）', token: env.CLOUDFLARE_TURNSTILE_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, siteKey, needWidget: true }));
  await run(checkCloudflareToken(deps, { id: 'C3', label: 'Cloudflare トークン（Workers 配備用）', token: env.CLOUDFLARE_WORKERS_TOKEN, needWidget: false }));
  await run(checkTurnstileSecret(deps, { secret: env.TURNSTILE_SECRET_KEY }));
  await run(checkOAuthClientAuthz(deps, { clientId: env.GMAIL_OAUTH_CLIENT_ID, redirectUri: env.PROBE_REDIRECT_URI || redirectUri, probe: !!env.PROBE_REDIRECT_URI }));   // PROBE_REDIRECT_URI: 反証用（C5 だけ差し替える）
  await run(checkOAuthClientSecret(deps, { clientId: env.GMAIL_OAUTH_CLIENT_ID, clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET, redirectUri }));
  await run(checkRefreshToken(deps, { clientId: env.GMAIL_OAUTH_CLIENT_ID, clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET, refreshToken: env.GMAIL_OAUTH_REFRESH_TOKEN, sender: env.MAIL_SENDER_USER }));
  await run(checkGitHubApp(deps, { appId: env.OPS_APP_ID, pem: env.OPS_APP_PRIVATE_KEY, owner, repo, nowSec: Math.floor(deps.now() / 1000) }));
  await run(checkCallbackPage(deps, { url: redirectUri, clientId: env.GMAIL_OAUTH_CLIENT_ID, sender: env.MAIL_SENDER_USER, repository: `${owner}/${repo}` }));
  const count = s => items.filter(i => i.status === s).length;
  return { items, pass: count(PASS), fail: count(FAIL), skip: count(SKIP), ok: count(FAIL) === 0 };
}

/* ---------- CLI ---------- */

function esc(s) { return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'); }
function main() {
  const deps = { fetch: (...a) => fetch(...a), now: () => Date.now(), readFile: p => { try { return readFileSync(p, 'utf8'); } catch { return ''; } } };
  return runAll(deps, process.env).then(r => {
    console.log(JSON.stringify(r));
    const md = ['## ops-check: ' + (r.ok ? '✅ 前提は全て満たしている' : `❌ FAIL ${r.fail} 件`) + `（PASS ${r.pass} / FAIL ${r.fail} / SKIP ${r.skip}）`, '', '| # | 項目 | 判定 | 詳細 | 次にやること |', '|---|---|---|---|---|',
      ...r.items.map(i => `| ${i.id} | ${i.name} | ${i.status === PASS ? '✅ PASS' : i.status === FAIL ? '❌ FAIL' : '⏭ SKIP'} | ${i.detail.replace(/\|/g, '\\|')} | ${i.next.replace(/\|/g, '\\|')} |`), '',
      '何も変更していない（偽コード・偽トークンによる検査のみ）。秘密の値は出力していない。'].join('\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    if (process.env.REPORT_FILE) writeFileSync(process.env.REPORT_FILE, [`ops-check: PASS ${r.pass} / FAIL ${r.fail} / SKIP ${r.skip}`, '', ...r.items.map(i => `${i.id} ${i.status} ${i.name} — ${i.detail}${i.next ? ` → ${i.next}` : ''}`), ''].join('\n'));
    if (process.env.GITHUB_ACTIONS) {
      for (const i of r.items) console.log(`::${i.status === FAIL ? 'error' : i.status === SKIP ? 'warning' : 'notice'} title=ops-check ${i.status}::${esc(`${i.id} ${i.name} — ${i.detail}${i.next ? ` → ${i.next}` : ''}`)}`);
      console.log(`::${r.ok ? 'notice' : 'error'} title=ops-check::${esc(`PASS ${r.pass} / FAIL ${r.fail} / SKIP ${r.skip}`)}`);
    }
    process.exit(r.ok ? 0 : 1);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
