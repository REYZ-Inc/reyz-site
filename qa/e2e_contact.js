// 問い合わせフォームの通し確認（メールは送らない）。2 つのモード:
//   ci   : CI 内で起動したフルスタック（サイト生成物 ＋ Worker、同一 origin）に対し、本物の Turnstile（公式テストキー）でフォーム UI を最後まで操作する。
//          ケース: pass（合格→受付・Google トークン取得）/ fail-widget（ウィジェット失敗→fail-open で受付）/ interactive（対話式→送信ボタンが待つ）/
//                  fail-secret（照合不合格→未検証で受付・codes に理由。Worker を「常に不合格」の秘密キーで起動して実行）
//   prod : 公開サイトに対し、確認ページまで操作して Turnstile の状態を観測し、dry_run='token' で Worker の照合と Google トークン取得まで確認する（自動操作ではトークンが出ないことがある。Google トークンが取れなければ失敗）。
// 使い方: node qa/e2e_contact.js --mode ci --base http://127.0.0.1:8787 --case pass
//         node qa/e2e_contact.js --mode prod --base https://reyz.inc
// 出力: JSON（fails / summary / out）。GitHub Actions では annotation と Step Summary にも出す。fails が 1 件でもあれば exit 1。
const { chromium } = require('playwright');
const fs = require('fs');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const MODE = args.mode || 'prod', BASE = (args.base || 'https://reyz.inc').replace(/\/$/, ''), CASE = args.case || 'pass';
const TEST_SITEKEY = { pass: '1x00000000000000000000AA', 'fail-widget': '2x00000000000000000000AB', interactive: '3x00000000000000000000FF', 'fail-secret': '1x00000000000000000000AA' };   // Cloudflare 公式テストキー
const OUT = process.env.QA_OUT || 'qa/out';

(async () => {
  const out = { mode: MODE, base: BASE, case: MODE === 'ci' ? CASE : undefined, console: [], errors: [], failed: [], posts: [] };
  const b = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
  const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') out.console.push(m.type() + ': ' + m.text().slice(0, 300)); });
  p.on('pageerror', e => out.errors.push(String(e)));
  p.on('requestfailed', r => out.failed.push((r.failure() || {}).errorText + ' ' + r.url().slice(0, 160)));
  if (MODE === 'ci') {
    // サイトキーをケースごとのテストキーに差し替え（配信ファイルは触らず、ブラウザ側で書き換える）
    await p.route('**/assets/site.js', async route => { const res = await route.fetch(); const body = (await res.text()).replace(/turnstileSiteKey: '[^']*'/, `turnstileSiteKey: '${TEST_SITEKEY[CASE]}'`); await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/javascript' } }); });
    // 送信は dry_run に切り替え（メールは送らない）。pass は Google のトークン取得まで、他は照合まで
    await p.route('**/api/contact', async route => {
      const req = route.request(); if (req.method() !== 'POST') return route.continue();
      const body = JSON.parse(req.postData() || '{}'); body.dry_run = CASE === 'pass' ? 'token' : true;
      const res = await route.fetch({ postData: JSON.stringify(body) }); let j = null; try { j = JSON.parse(await res.text()); } catch (e) {}
      out.posts.push({ status: res.status(), client: body.client && body.client.turnstile, token: !!body.turnstile, body: j });
      await route.fulfill({ response: res, body: JSON.stringify(j), headers: { ...res.headers(), 'content-type': 'application/json; charset=utf-8' } });
    });
  }
  await p.goto(BASE + '/contact.html', { waitUntil: 'load' }); await p.waitForTimeout(1200);
  await p.fill('#cName', 'E2E 通し確認'); await p.fill('#cLocal', 'e2e'); await p.selectOption('#cDomain', '__other'); await p.fill('#cDomainOther', 'example.com');
  await p.selectOption('#cType', { index: 1 }); await p.fill('#cMsg', '自動確認（dry_run）。メールは送信されません。');
  await p.click('#confirmBtn');
  const tsRead = () => p.evaluate(() => { const t = window.__reyzContact; return t ? { state: t.state, token: !!t.token, error: t.error, widget: t.widget !== null, boxHeight: (document.getElementById('turnstileBox') || {}).offsetHeight || 0 } : null; });
  // Turnstile: トークン取得か終端状態まで最大 25 秒（interactive は「表示されて待つ」が正）
  let ts = null;
  for (let i = 0; i < 50; i++) { await p.waitForTimeout(500); ts = await tsRead(); if (!ts || ts.token || !['pending', 'rendered'].includes(ts.state) || (ts.boxHeight > 20)) break; }
  out.turnstile = ts;
  const fails = [];
  if (MODE === 'ci') {
    await p.click('#sendBtn');
    if (CASE === 'interactive') {
      await p.waitForTimeout(2500);
      out.status = await p.evaluate(() => document.getElementById('sendStatus').textContent);
      if (!(ts && ts.boxHeight > 20)) fails.push('interactive: 対話式ウィジェットが表示されていない');
      if (!/完了してから/.test(out.status)) fails.push('interactive: 送信ボタンが待たずに進んだ: ' + out.status);
      if (out.posts.length) fails.push('interactive: 未完了のまま POST された');
    } else {
      await p.waitForFunction(() => !document.getElementById('stepDone').hidden || document.getElementById('sendStatus').textContent.length > 4, null, { timeout: 40000 }).catch(() => {});
      out.done = await p.evaluate(() => ({ done: !document.getElementById('stepDone').hidden, note: !document.getElementById('doneNote').hidden, status: document.getElementById('sendStatus').textContent }));
      const last = out.posts[out.posts.length - 1];
      if (!out.done.done) fails.push(CASE + ': 完了画面にならない: ' + out.done.status);
      if (!last || last.status !== 200 || !last.body || last.body.ok !== true) fails.push(CASE + ': 最終応答が受付成功でない: ' + JSON.stringify(last));
      if (CASE === 'pass') {
        if (!(last && last.body && last.body.verified === true)) fails.push('pass: Turnstile 検証済みにならない: ' + JSON.stringify(last && last.body));
        if (!(last && last.body && last.body.google_token === true)) fails.push('pass: Google のアクセストークンが取れない（no-reply@ の OAuth）: ' + JSON.stringify(last && last.body));
        if (!(last && last.token && last.client === 'ok')) fails.push('pass: フォームがトークンを添えていない: ' + JSON.stringify(last));
        if (out.done.note) fails.push('pass: 検証済みなのに「確認メールなし」の注記が出た');
      }
      if (CASE === 'fail-widget') {
        if (!(last && last.body && last.body.verified === false)) fails.push('fail-widget: 未検証として受付されていない: ' + JSON.stringify(last && last.body));
        if (!out.done.note) fails.push('fail-widget: 「確認メールなし」の注記が出ない');
      }
      if (CASE === 'fail-secret') {   // accept-flagged 方針では、照合不合格のトークンは 403 にせずその場で未検証受付（codes に不合格理由が残る）
        if (!(last && last.token)) fails.push('fail-secret: フォームがトークンを添えていない: ' + JSON.stringify(last));
        if (!(last && last.body && last.body.verified === false && (last.body.codes || []).length)) fails.push('fail-secret: 照合不合格が未検証受付として記録されていない: ' + JSON.stringify(last && last.body));
        if (!out.done.note) fails.push('fail-secret: 「確認メールなし」の注記が出ない');
      }
    }
  } else {
    out.dry_run = await p.evaluate(async () => {
      const t = window.__reyzContact || {};
      // dry_run='token': 照合のあと Google のアクセストークン取得まで行い、送信はしない（本番の同意の生存を毎回・毎日確かめる。失効は送信前に検知）
      const body = { name: 'E2E 通し確認', person: '', email: 'e2e@example.com', type: 'その他', message: '自動確認（dry_run）', website: '', turnstile: t.token || '', client: { turnstile: t.token ? 'ok' : (t.state || 'none') }, dry_run: 'token' };
      try { const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await res.json(); } catch (e) {} return { status: res.status, body: j }; }
      catch (e) { return { status: 0, error: String(e) }; }
    });
    if (!out.dry_run || out.dry_run.status !== 200 || !out.dry_run.body || out.dry_run.body.ok !== true) fails.push('worker dry_run: ' + JSON.stringify(out.dry_run));
    else if (out.dry_run.body.google_token !== true) fails.push('google token: 本番 Worker が Google のアクセストークンを取得できない（同意の失効・クライアント不正・API 無効のいずれか。detail=' + (out.dry_run.body.detail || '-') + '）。workers/contact/README.md「認証情報の更新」');
    if (!ts) fails.push('turnstile: 状態が読めない（site.js が古い／__reyzContact なし）');
    else if (['blocked', 'error', 'render-error', 'unsupported'].includes(ts.state)) fails.push('turnstile: ' + ts.state + ' ' + (ts.error || ''));
    else if (ts.token && out.dry_run && out.dry_run.body && out.dry_run.body.verified === false) fails.push('turnstile: トークンはあるが siteverify 不合格 ' + JSON.stringify(out.dry_run.body.codes) + '（Worker の TURNSTILE_SECRET_KEY を確認）');
  }
  if (out.errors.length) fails.push('page errors: ' + out.errors.join(' | '));
  try { fs.mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: `${OUT}/e2e_contact_${MODE}_${CASE}.png` }); } catch (e) {}
  await b.close();
  const label = MODE === 'ci' ? `ci/${CASE}` : `prod ${BASE}`;
  const summary = `[${label}] turnstile=${ts ? ts.state + (ts.token ? '(token)' : '(no token)') : 'n/a'}` + (MODE === 'ci' ? ` posts=${out.posts.map(x => x.status + (x.body && x.body.verified !== undefined ? '/v=' + x.body.verified : '') + (x.body && x.body.google_token !== undefined ? '/g=' + x.body.google_token : '')).join(',') || '-'}` : ` dry_run=${out.dry_run ? out.dry_run.status + ' ' + JSON.stringify(out.dry_run.body) : 'n/a'}`)
    + ` errors=${out.errors.length} failedRequests=${out.failed.length} console=${out.console.length}` + (out.failed.length ? ' | failed: ' + out.failed.slice(0, 3).join(' ; ') : '') + (out.console.length ? ' | console: ' + out.console.slice(0, 3).join(' ; ').slice(0, 400) : '');
  console.log(JSON.stringify({ fails, summary, out }, null, 1));
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::${fails.length ? 'error' : 'notice'} title=contact-e2e ${label}::${summary}${fails.length ? ' | FAIL: ' + fails.join(' / ') : ''}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## contact-e2e ${label}\n\n${summary}\n\n${fails.map(f => '- FAIL: ' + f).join('\n')}\n\n<details><summary>detail</summary>\n\n\`\`\`json\n${JSON.stringify(out, null, 1)}\n\`\`\`\n</details>\n`);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
