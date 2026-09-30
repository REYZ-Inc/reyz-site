// 異常通知を運用窓口（NOC_EMAIL、既定 noc@reyz.inc）へメールで送る。GitHub Actions から使う。
// 送信経路は問い合わせ Worker と同じ（送信専用ユーザー no-reply@ の OAuth → Gmail API。移行期間はサービスアカウントも可）。
// Worker 本体の accessToken / buildMime をそのまま使うので、送信ロジックは 1 か所（workers/contact/src/index.js）だけ。
// 使い方: node infra/check/notify_noc.mjs --subject "件名" --body-file report.txt [--to noc@reyz.inc]
//   環境変数: GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN（または GMAIL_SA_KEY + GMAIL_SENDER_USER）, MAIL_FROM（既定 REYZ Inc. <no-reply@reyz.inc>）
// 送れなかった場合は exit 2（呼び出し側の workflow が失敗として見える）。本文に秘密を入れないこと。
import { readFileSync } from 'node:fs';
import { accessToken, authMode, buildMime, b64url } from '../../workers/contact/src/index.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const to = args.to || process.env.NOC_EMAIL || 'noc@reyz.inc';
const subject = args.subject || '[REYZ noc] 通知';
const body = args['body-file'] ? readFileSync(args['body-file'], 'utf8') : (args.body || '');
const from = process.env.MAIL_FROM || 'REYZ Inc. <no-reply@reyz.inc>';
if (!authMode(process.env)) { console.error('送信の認証情報がない（GMAIL_OAUTH_* または GMAIL_SA_KEY + GMAIL_SENDER_USER）'); process.exit(2); }

let token;
try { token = await accessToken({ fetch: (...a) => fetch(...a), now: () => Date.now() }, process.env); }
catch (err) { console.error('token:', String(err).replace(/[^\x20-\x7e]/g, '').slice(0, 300)); process.exit(2); }
const mime = buildMime({ from, to, subject, text: body + `\n\n--\n送信: GitHub Actions ${process.env.GITHUB_WORKFLOW || ''} run ${process.env.GITHUB_RUN_ID || ''}（auth: ${authMode(process.env)}）\n${process.env.GITHUB_SERVER_URL || ''}/${process.env.GITHUB_REPOSITORY || ''}/actions/runs/${process.env.GITHUB_RUN_ID || ''}` });
const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(new TextEncoder().encode(mime)) }) });
const rj = await res.json().catch(() => ({}));
if (!res.ok) { console.error('gmail send', res.status, JSON.stringify(rj).slice(0, 300)); process.exit(2); }
console.log(`notified ${to}: ${subject} (gmail id ${rj.id || '-'})`);
