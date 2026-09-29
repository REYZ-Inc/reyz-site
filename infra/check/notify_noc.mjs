// 異常通知を運用窓口（NOC_EMAIL、既定 noc@reyz.inc）へメールで送る。GitHub Actions から使う。
// 送信経路は問い合わせ Worker と同じ（Google Workspace のサービスアカウント → Gmail API、差出人 no-reply@）。
// Worker 本体の makeJwt / buildMime をそのまま使うので、送信ロジックは 1 か所（workers/contact/src/index.js）だけ。
// 使い方: node infra/check/notify_noc.mjs --subject "件名" --body-file report.txt [--to noc@reyz.inc]
//   環境変数: GMAIL_SA_KEY（JSON 鍵の全文）, GMAIL_SENDER_USER（なりすまし先ユーザー）, MAIL_FROM（既定 REYZ Inc. <no-reply@reyz.inc>）
// 送れなかった場合は exit 2（呼び出し側の workflow が失敗として見える）。本文に秘密を入れないこと。
import { readFileSync } from 'node:fs';
import { makeJwt, buildMime, b64url } from '../../workers/contact/src/index.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const to = args.to || process.env.NOC_EMAIL || 'noc@reyz.inc';
const subject = args.subject || '[REYZ noc] 通知';
const body = args['body-file'] ? readFileSync(args['body-file'], 'utf8') : (args.body || '');
const sa = JSON.parse(process.env.GMAIL_SA_KEY || '{}');
const sub = process.env.GMAIL_SENDER_USER;
const from = process.env.MAIL_FROM || 'REYZ Inc. <no-reply@reyz.inc>';
if (!sa.client_email || !sa.private_key || !sub) { console.error('GMAIL_SA_KEY / GMAIL_SENDER_USER がない'); process.exit(2); }

const assertion = await makeJwt(sa, sub, Date.now());
const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
const tj = await tok.json().catch(() => ({}));
if (!tok.ok || !tj.access_token) { console.error('token endpoint', tok.status, JSON.stringify(tj).replace(/[^\x20-\x7e]/g, '').slice(0, 300)); process.exit(2); }
const mime = buildMime({ from, to, subject, text: body + `\n\n--\n送信: GitHub Actions ${process.env.GITHUB_WORKFLOW || ''} run ${process.env.GITHUB_RUN_ID || ''}\n${process.env.GITHUB_SERVER_URL || ''}/${process.env.GITHUB_REPOSITORY || ''}/actions/runs/${process.env.GITHUB_RUN_ID || ''}` });
const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${tj.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(new TextEncoder().encode(mime)) }) });
const rj = await res.json().catch(() => ({}));
if (!res.ok) { console.error('gmail send', res.status, JSON.stringify(rj).slice(0, 300)); process.exit(2); }
console.log(`notified ${to}: ${subject} (gmail id ${rj.id || '-'})`);
