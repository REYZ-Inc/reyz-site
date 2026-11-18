// Regressions for late replies, preserved consultation intent and ambiguous contact delivery.
// All API requests terminate in this local fixture. No email or model call is made.
// --source serves the editable script instead of its generated hash copy during development.
const { chromium, webkit } = require('playwright');
const fs = require('fs'); const path = require('path'); const http = require('http');
const ROOT = path.resolve(process.argv[2] || 'site');
const sourceOverride = process.argv.includes('--source'), quick = process.argv.includes('--quick');
const OUTPUT = process.argv[3] && !process.argv[3].startsWith('--') ? path.resolve(process.argv[3]) : process.env.QA_OUT || path.join(__dirname, 'out', 'refinement');
fs.mkdirSync(OUTPUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
const script = /^\/assets\/site(?:\.[a-f0-9]{16})?\.js$/;
const experience = /^\/assets\/experience(?:\.[a-f0-9]{16})?\.js$/;
const api = { mode: 'ok', turns: [], contacts: [], pending: [], partial: [] };
const json = (res, body, status = 200) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const cutPartial = () => { for (const res of api.partial.splice(0)) res.destroy(); };
const release = () => { for (const done of api.pending.splice(0)) done(); cutPartial(); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/api/consensus/health') return json(res, { ok: true, ready: true });
  if (url.pathname === '/api/consensus/turn' || url.pathname === '/api/contact') {
    let raw = ''; req.on('data', part => { raw += part; }); req.on('end', () => {
      const value = JSON.parse(raw); const talk = url.pathname.endsWith('/turn');
      (talk ? api.turns : api.contacts).push(value);
      const done = () => json(res, talk ? { ok: true, reply: '以前の選択への返事です。', map: { goal: '古い応答で上書きされる目的', place: '古い場所', step: '古い一歩' }, chain: 'a'.repeat(64), consult: true } : { ok: true, verified: true });
      if (api.mode === 'hold') api.pending.push(done);
      else if (api.mode === 'network') res.destroy();
      else if (api.mode === 'partial') {
        // The complete request has been received. Keep the response open until
        // Playwright observes its headers, then interrupt the incomplete body.
        api.partial.push(res);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength('{"ok":true,"verified":true}'), 'Cache-Control': 'no-store' });
        res.flushHeaders(); res.write('{"ok":');
      }
      else if (api.mode === 'server-error') json(res, { ok: false, error: 'send', stage: 'after-acceptance' }, 502);
      else if (api.mode === 'fail') json(res, { ok: false, error: 'model' }, 502);
      else done();
    }); return;
  }
  let file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (sourceOverride && script.test(url.pathname)) file = path.join(ROOT, 'assets/site.js');
  if (sourceOverride && experience.test(url.pathname)) file = path.join(ROOT, 'assets/experience.js');
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (script.test(url.pathname)) body = Buffer.from(body.toString().replace(/turnstileSiteKey: '[^']*'/, "turnstileSiteKey: ''"));
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(body);
});

const browsers = [];
const report = { sourceOverride, quick, checks: [], fails: [], cases: {} };
const saveReport = () => fs.writeFileSync(path.join(OUTPUT, 'refinement.json'), JSON.stringify(report, null, 2));
async function click(locator) {
  await locator.scrollIntoViewIfNeeded();
  // Keep normal actionability checks: initial scroll restoration, moving targets,
  // overlays and hidden controls must settle or fail instead of being bypassed.
  await locator.click({ timeout: 15000 });
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const check = (name, result, details) => { report.checks.push({ name, passed: !!result }); if (!result) report.fails.push({ name, details }); };
  const configurations = quick ? [['chromium-desktop', chromium, { width: 1440, height: 900 }]] : [['chromium-desktop', chromium, { width: 1440, height: 900 }], ['webkit-mobile', webkit, { width: 390, height: 844 }]];
  for (const [label, engine, viewport] of configurations) {
    let browser, context, page;
    const errors = [], mutations = [];
    report.cases[label] = { completed: false, errors, mutations };
    try {
    browser = await engine.launch(); browsers.push(browser); context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      // Observe application invocations without replacing native networking,
      // changing arguments/signals, or wrapping the returned promise.
      window.__reyzContactFetchCalls = [];
      window.fetch = new Proxy(window.fetch, {
        apply(target, receiver, args) {
          try {
            const [input, init] = args;
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
            if (url.pathname === '/api/contact') window.__reyzContactFetchCalls.push({ method: (init?.method || input?.method || 'GET').toUpperCase(), at: performance.now() });
          } catch (_) {} // Observation must not change native fetch behavior.
          return Reflect.apply(target, receiver, args);
        }
      });
    });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await context.route('**/*', route => { const request = route.request(); if (new URL(request.url()).origin === origin) return route.continue(); if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.url()); return route.abort(); });
    const open = async p => { release(); api.mode = 'ok'; api.turns.length = 0; api.contacts.length = 0; await page.goto(origin + p, { waitUntil: 'load' }); };
    const pick = async (q, aud, value) => click(page.locator(`.mq[data-q="${q}"][data-for="${aud}"] .opt[data-v="${value}"]`));
    const creator = async () => { await pick('who', 'all', 'creator'); for (const [q,v] of [['goal','yes'],['place','yes'],['style','live'],['make','share'],['value','last']]) await pick(q,'creator',v); await page.waitForFunction(() => !document.getElementById('mapTalk').hidden); };
    const company = async () => { await pick('who','all','company'); for (const [q,v] of [['goal','yes'],['focus','ops'],['first','speed']]) await pick(q,'company',v); };
    const waitCount = async (key, n) => { const until = Date.now() + 3000; while (api[key].length < n && Date.now() < until) await page.waitForTimeout(20); if (api[key].length < n) throw new Error(`${key}: request not received`); };
    const sendTalk = async text => { await page.fill('#talkInput', text); await click(page.locator('#talkSend')); await waitCount('turns', 1); };
    const fillContact = async text => { await page.fill('#cName','検証'); await page.fill('#cEmail','review@example.test'); await page.selectOption('#cType',{ label:'活動・収益化の相談' }); await page.fill('#cMsg',text); await click(page.locator('#confirmBtn')); };
    const deliveryState = () => page.evaluate(() => ({ status: document.getElementById('sendStatus').textContent, fallback: !document.getElementById('copyLabel').hidden, done: !document.getElementById('stepDone').hidden, disabled: document.getElementById('sendBtn').disabled, message: document.getElementById('cMsg').value }));
    const contactCounts = async () => ({ applicationFetchCalls: await page.evaluate(() => window.__reyzContactFetchCalls.length), serverRequests: api.contacts.length });
    const unknownDelivery = delivery => /結果|確認でき/.test(delivery.status) && delivery.fallback && !delivery.done && !delivery.disabled;

    // An old request must not change the new audience's map or conversation.
    await open('/index.html'); await creator(); api.mode = 'hold'; await sendTalk('クリエイターとして配信したい');
    await pick('who','all','company');
    check(label + '/unfinished new map cannot carry the old audience', await page.evaluate(() => sessionStorage.getItem('reyz.map.r') === null));
    await company(); const before = await page.locator('#mapGoal').textContent(); release(); await page.waitForTimeout(180);
    const stale = await page.evaluate(() => ({ goal: document.getElementById('mapGoal').textContent, lines: document.querySelectorAll('.talk-line').length, who: JSON.parse(sessionStorage.getItem('reyz.map.r')).who, busy: document.getElementById('mapTalk').classList.contains('is-busy') }));
    check(label + '/old reply cannot overwrite new audience', stale.goal === before && stale.lines === 0 && stale.who === 'company' && !stale.busy, stale);

    // An unanswered question and a draft remain available in the consultation.
    await open('/index.html'); await creator(); api.mode = 'fail'; const question = '週末だけ活動する場合の進め方を相談したい'; await sendTalk(question);
    await page.waitForFunction(() => !document.getElementById('mapTalk').classList.contains('is-busy'));
    check(label + '/failed question restored to input', await page.inputValue('#talkInput') === question);
    await Promise.all([page.waitForURL('**/contact'), click(page.locator('#mapGo'))]);
    check(label + '/unanswered question included in consultation', (await page.inputValue('#cMsg')).includes(question));
    await open('/index.html'); await creator(); const draft = 'この条件も相談に含めてください'; await page.fill('#talkInput',draft);
    await Promise.all([page.waitForURL('**/contact'), click(page.locator('#mapGo'))]);
    check(label + '/unsent draft included in consultation', (await page.inputValue('#cMsg')).includes(draft));
    check(label + '/consultation does not send draft to model', api.turns.length === 0);

    // Moving through a service page must preserve the person's own words too.
    await open('/index.html'); await creator(); const viaPage = 'サービスを見た後もこの相談文を残してほしい'; await page.fill('#talkInput',viaPage);
    await Promise.all([page.waitForURL('**/creator#model'), click(page.locator('#mapScreens'))]);
    await Promise.all([page.waitForURL('**/contact'), click(page.locator('[data-consult-page]').last())]);
    check(label + '/service page preserves the Home conversation', (await page.inputValue('#cMsg')).includes(viaPage));

    // The normal header / mobile menu is an equally valid route to the service page.
    await open('/index.html'); await creator(); const viaHeader = '通常メニューから移動しても残す相談文'; await page.fill('#talkInput',viaHeader);
    if (viewport.width < 760) await click(page.locator('#menuBtn'));
    const headerCreator = page.locator(viewport.width < 760 ? '#sheet a[href="creator"]' : '#siteHeader .nav a[href="creator"]');
    await Promise.all([page.waitForURL('**/creator'), click(headerCreator)]);
    await Promise.all([page.waitForURL('**/contact'), click(page.locator('[data-consult-page]').last())]);
    check(label + '/normal navigation preserves the Home draft', (await page.inputValue('#cMsg')).includes(viaHeader));
    check(label + '/normal navigation never submits the Home draft', api.turns.length === 0);

    // A long handoff is retained verbatim and asks for editing rather than dropping later words.
    await open('/contact.html'); const longBody = '相談したいこと。'.repeat(800);
    await page.evaluate(body => sessionStorage.setItem('reyz.map',JSON.stringify({ type:'活動・収益化の相談',body })),longBody);
    await page.reload({ waitUntil:'load' }); await page.fill('#cName','検証'); await page.fill('#cEmail','review@example.test');
    await click(page.locator('#confirmBtn'));
    check(label + '/long handoff is not silently truncated', (await page.inputValue('#cMsg')).trim() === longBody);
    check(label + '/long handoff requires correction before sending', await page.evaluate(() => document.getElementById('stepConfirm').hidden && /5,000/.test(document.getElementById('cMsg').validationMessage)));

    // The visitor's explicit route is intent; simulated deals and verdicts are not.
    await open('/creator.html'); await click(page.locator('.path-goal').last());
    const selectedGoal = (await page.locator('.path-goal[aria-pressed="true"]').textContent()).trim();
    await Promise.all([page.waitForURL('**/contact'), click(page.locator('#path [data-consult-page]'))]);
    check(label + '/chosen path reaches consultation', (await page.inputValue('#cMsg')).includes(selectedGoal), { selectedGoal, message: await page.inputValue('#cMsg') });

    // Confirmation and sending are one in-flight operation, even if Back / Enter arrives.
    await open('/contact.html'); await fillContact('二重操作の検証'); api.mode = 'hold'; await click(page.locator('#sendBtn')); await waitCount('contacts',1);
    const backLocked = await page.locator('#backBtn').isDisabled();
    await page.evaluate(() => { document.getElementById('contactForm').requestSubmit(); document.getElementById('sendBtn').dispatchEvent(new MouseEvent('click',{ bubbles:true })); });
    await page.waitForTimeout(100); check(label + '/send cannot be re-entered', api.contacts.length === 1 && backLocked, { requests: api.contacts.length, backLocked });
    await page.evaluate(() => history.back()); await page.waitForTimeout(150);
    check(label + '/browser Back preserves in-flight confirmation', await page.evaluate(() => !document.getElementById('stepConfirm').hidden && document.getElementById('sendBtn').disabled));
    release(); await page.waitForFunction(() => !document.getElementById('stepDone').hidden);
    check(label + '/successful response completes once', api.contacts.length === 1);

    // Preserve the original pre-header disconnect. A browser may retry a reused
    // connection internally, so record server receipts separately from app calls.
    await open('/contact.html'); await fillContact('通信切断の検証'); api.mode = 'network'; await click(page.locator('#sendBtn')); await waitCount('contacts',1); await page.waitForTimeout(1800);
    const delivery = await deliveryState(), beforeHeaders = await contactCounts();
    report.cases[label].beforeHeadersDisconnect = { ...beforeHeaders, delivery };
    check(label + '/pre-header disconnect has no application resend', beforeHeaders.applicationFetchCalls === 1 && beforeHeaders.serverRequests >= 1, beforeHeaders);
    check(label + '/ambiguous delivery is stated honestly with recovery', unknownDelivery(delivery) && delivery.message === '通信切断の検証', delivery);

    // Simulate acceptance followed by a lost response body. Observed headers
    // distinguish this from the native transport retry case above.
    await open('/contact.html'); await fillContact('応答途中切断の検証'); api.mode = 'partial';
    const [partialResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/contact' && response.request().method() === 'POST' && response.status() === 200),
      click(page.locator('#sendBtn'))
    ]);
    cutPartial();
    await waitCount('contacts',1); await page.waitForTimeout(1800);
    const partialDelivery = await deliveryState(), afterHeaders = await contactCounts();
    report.cases[label].afterHeadersDisconnect = { ...afterHeaders, observedStatus: partialResponse.status(), delivery: partialDelivery };
    check(label + '/body interruption has one application call and one server receipt', afterHeaders.applicationFetchCalls === 1 && afterHeaders.serverRequests === 1, afterHeaders);
    check(label + '/body interruption retains intent with unknown receipt', unknownDelivery(partialDelivery) && partialDelivery.message === '応答途中切断の検証', partialDelivery);

    // A server error after simulated acceptance must not trigger an application
    // retry either. The observation window includes the former 1.5 s retry delay.
    await open('/contact.html'); await fillContact('受付後502応答の検証'); api.mode = 'server-error';
    const [errorResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/contact' && response.request().method() === 'POST' && response.status() === 502),
      click(page.locator('#sendBtn'))
    ]);
    await waitCount('contacts',1); await page.waitForTimeout(1800);
    const serverErrorDelivery = await deliveryState(), serverError = await contactCounts();
    report.cases[label].serverErrorAfterAcceptance = { ...serverError, observedStatus: errorResponse.status(), delivery: serverErrorDelivery };
    check(label + '/502 has one application call and one server receipt', serverError.applicationFetchCalls === 1 && serverError.serverRequests === 1, serverError);
    check(label + '/502 retains intent with unknown receipt', unknownDelivery(serverErrorDelivery) && serverErrorDelivery.message === '受付後502応答の検証', serverErrorDelivery);

    if (!quick) {
      await open('/index.html'); await creator(); api.mode = 'hold'; const question = '返事がなくても相談に進めるかを確認'; await sendTalk(question);
      await page.waitForFunction(() => !document.getElementById('mapTalk').classList.contains('is-busy'),null,{ timeout:25000 }).catch(() => {});
      check(label + '/AI response deadline restores the question', await page.inputValue('#talkInput') === question && !(await page.locator('#talkInput').isDisabled()));
      release(); await page.waitForTimeout(100);
      check(label + '/late AI reply after deadline cannot change map', !(await page.locator('#mapGoal').textContent()).includes('古い応答'));
      // Native wall time: a server that never finishes must not freeze the form indefinitely.
      await open('/contact.html'); await fillContact('応答期限の検証'); api.mode = 'hold'; const started = Date.now(); await click(page.locator('#sendBtn')); await waitCount('contacts',1);
      await page.waitForFunction(() => !document.getElementById('copyLabel').hidden && !document.getElementById('sendBtn').disabled, null, { timeout: 25000 }).catch(() => {});
      const timeout = await page.evaluate(() => ({ note: document.getElementById('sendStatus').textContent, waiting: document.getElementById('sendBtn').disabled, done: !document.getElementById('stepDone').hidden, preserved: document.getElementById('cMsg').value }));
      check(label + '/bounded wait retains message and recovery', !timeout.waiting && !timeout.done && timeout.preserved === '応答期限の検証' && /結果|確認でき/.test(timeout.note), timeout);
      check(label + '/timeout does not claim receipt was cancelled', !/取り消しました|キャンセルしました/.test(timeout.note));
      check(label + '/timeout never retries automatically', api.contacts.length === 1);
      report.cases[label].timeoutMilliseconds = Date.now() - started;
      release(); await page.waitForTimeout(100);
      check(label + '/late timeout response cannot show success', await page.locator('#stepDone').isHidden());
    }
    await page.screenshot({ path: path.join(OUTPUT, label + '.png') });

    // Utility-page evidence is captured with empty fields and no external submission.
    await open('/contact.html');
    await page.screenshot({ path: path.join(OUTPUT, label + '-contact-initial.png') });
    if (viewport.width < 760) {
      await click(page.locator('#menuBtn'));
      await page.screenshot({ path: path.join(OUTPUT, label + '-mobile-menu.png') });
      await page.keyboard.press('Escape');
    }
    await open('/404.html');
    const heading = page.locator('h1'), home = page.locator('#back a[href="/"]');
    check(label + '/404 has one visible heading', await heading.count() === 1 && await heading.isVisible() && (await heading.textContent()).trim().length > 0);
    check(label + '/404 has a visible Home return link', await home.count() === 1 && await home.isVisible());
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    check(label + '/404 has no horizontal overflow', layout.scroll <= layout.width + 1, layout);
    await page.screenshot({ path: path.join(OUTPUT, label + '-404.png') });
    await Promise.all([page.waitForURL(origin + '/'), click(home)]);
    check(label + '/404 Home return opens the homepage', await page.locator('#mapper').count() === 1 && new URL(page.url()).pathname === '/');

    check(label + '/no external mutation requests', mutations.length === 0, mutations);
    check(label + '/no browser errors', errors.length === 0, errors);
    report.cases[label].completed = true;
    } catch (error) {
      check(label + '/journey completed', false, String(error.stack || error));
      report.cases[label].error = String(error.stack || error);
    } finally {
      if (page && !page.isClosed()) {
        report.cases[label].lastUrl = page.url();
        if (!report.cases[label].completed) {
          const file = label + '-failure.png';
          try { await page.screenshot({ path: path.join(OUTPUT, file), timeout: 10000 }); report.cases[label].failureScreenshot = file; }
          catch (error) { report.cases[label].screenshotError = String(error); }
          try { report.cases[label].failureViewport = await page.evaluate(() => ({ scrollX, scrollY, width: innerWidth, height: innerHeight, activeElement: document.activeElement?.id || '', page: document.body.dataset.page })); }
          catch (error) { report.cases[label].snapshotError = String(error); }
        }
      }
      saveReport();
      release();
      if (context) await context.close();
      if (browser) await browser.close();
    }
  }
})().catch(error => { report.fails.push({ name: 'test harness', details: String(error.stack || error) }); process.exitCode = 1; }).finally(async () => {
  saveReport(); console.log(JSON.stringify(report, null, 2)); if (report.fails.length) process.exitCode = 1;
  release(); server.closeAllConnections(); server.close(); await Promise.allSettled(browsers.map(browser => browser.close()));
});
