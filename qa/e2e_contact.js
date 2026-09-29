// 公開サイトの問い合わせフォームを、拡張機能のない Chromium（GitHub のランナー）で通しで確認する。メールは送らない（dry_run）。
// 使い方: node qa/e2e_contact.js [https://reyz.inc]
// 見るもの: ページエラー・失敗リクエスト、Turnstile の状態（トークン取得まで）、Worker の dry_run 応答（照合結果・レート制限）。
// 終了コード 1: ページエラー / Worker に届かない / Turnstile が読めない・壊れている / トークンがあるのに照合不合格（= secret 設定の疑い）。
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'https://reyz.inc').replace(/\/$/, '');
(async () => {
  const out = { base: BASE, console: [], errors: [], failed: [] };
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') out.console.push(m.type() + ': ' + m.text().slice(0, 300)); });
  p.on('pageerror', e => out.errors.push(String(e)));
  p.on('requestfailed', r => out.failed.push((r.failure() || {}).errorText + ' ' + r.url().slice(0, 160)));
  await p.goto(BASE + '/contact.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  await p.fill('#cName', 'E2E 通し確認'); await p.fill('#cLocal', 'e2e'); await p.selectOption('#cDomain', '__other'); await p.fill('#cDomainOther', 'example.com');
  await p.selectOption('#cType', { index: 1 }); await p.fill('#cMsg', '自動確認（dry_run）。メールは送信されません。');
  await p.click('#confirmBtn');
  // Turnstile: ok（トークン取得）か、終端状態（blocked / error / render-error / unsupported）になるまで最大 25 秒
  let ts = null;
  for (let i = 0; i < 50; i++) { await p.waitForTimeout(500); ts = await p.evaluate(() => { const t = window.__reyzContact; return t ? { state: t.state, token: !!t.token, error: t.error, widget: t.widget !== null } : null; }); if (!ts || ts.token || !['pending', 'rendered'].includes(ts.state)) break; }
  out.turnstile = ts;
  // Worker へ dry_run（同一オリジン、ページの fetch を使う）
  out.dry_run = await p.evaluate(async () => {
    const t = window.__reyzContact || {};
    const body = { name: 'E2E 通し確認', person: '', email: 'e2e@example.com', type: 'その他', message: '自動確認（dry_run）', website: '', turnstile: t.token || '', client: { turnstile: t.token ? 'ok' : (t.state || 'none') }, dry_run: true };
    try { const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await res.json(); } catch (e) {} return { status: res.status, body: j }; }
    catch (e) { return { status: 0, error: String(e) }; }
  });
  await p.screenshot({ path: (process.env.QA_OUT || 'qa/out') + '/e2e_contact.png', fullPage: false }).catch(() => {});
  await b.close();
  const fails = [];
  if (out.errors.length) fails.push('page errors: ' + out.errors.join(' | '));
  if (!out.dry_run || out.dry_run.status !== 200 || !out.dry_run.body || out.dry_run.body.ok !== true) fails.push('worker dry_run: ' + JSON.stringify(out.dry_run));
  if (!ts) fails.push('turnstile: 状態が読めない（site.js が古い／__reyzContact なし）');
  else if (['blocked', 'error', 'render-error', 'unsupported'].includes(ts.state)) fails.push('turnstile: ' + ts.state + ' ' + (ts.error || ''));
  else if (ts.token && out.dry_run && out.dry_run.body && out.dry_run.body.verified === false) fails.push('turnstile: トークンはあるが siteverify 不合格 ' + JSON.stringify(out.dry_run.body.codes) + '（Worker の TURNSTILE_SECRET_KEY を確認）');
  const summary = `turnstile=${ts ? ts.state + (ts.token ? '(token)' : '(no token)') : 'n/a'} dry_run=${out.dry_run ? out.dry_run.status + ' ' + JSON.stringify(out.dry_run.body) : 'n/a'} errors=${out.errors.length} failedRequests=${out.failed.length} console=${out.console.length}`;
  console.log(JSON.stringify({ fails, summary, out }, null, 1));
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::${fails.length ? 'error' : 'notice'} title=contact-e2e ${BASE}::${summary}${fails.length ? ' | FAIL: ' + fails.join(' / ') : ''}`);
    if (process.env.GITHUB_STEP_SUMMARY) require('fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## contact-e2e ${BASE}\n\n${summary}\n\n${fails.map(f => '- FAIL: ' + f).join('\n')}\n\n<details><summary>detail</summary>\n\n\`\`\`json\n${JSON.stringify(out, null, 1)}\n\`\`\`\n</details>\n`);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
