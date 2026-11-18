// Acceptance criteria fixed before reading the full-cycle implementation:
// - Approval precedes an explicit request; a request is not confirmed execution.
// - Changed assets/terms invalidate approval; old public work must stop before a new request.
// - Unknown outcomes cannot cause duplicate requests; reset removes prior state.
// - One sample case runs through results and a confirmed statement without external writes.
// - Economic feasibility uses unrounded values, including equality and the 65-item trap.
// - Editorial media has a decodable poster, real pause/play, and respects reduced motion.
// Run: node qa/cycle_check.js site [output-directory]
// All assertions concern visible behavior, semantic state, or independent expected numbers.
// No inquiry, publication, payment, or other external mutation is allowed by this suite.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(process.argv[2] || 'site');
const OUT = path.resolve(process.argv[3] || path.join(process.env.QA_OUT || 'qa/out', 'cycle'));
const report = { checks: 0, fails: [], cases: [], browsers: [], screenshots: [], mutationRequests: [] };
const browsers = [];
let server;
let base = process.env.BASE || process.env.QA_BASE;

function check(label, ok, detail) {
  report.checks++;
  if (!ok) report.fails.push(label + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  return ok;
}

function serve(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end(); }
  let file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
  const size = fs.statSync(file).size;
  // Real media decoders may request byte ranges, especially WebKit.
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); }
    res.writeHead(206, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
    'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

async function contextFor(browser, options) {
  const context = await browser.newContext({ serviceWorkers: 'block', ...options });
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      report.mutationRequests.push({ url: request.url(), method: request.method() });
      return route.abort();
    }
    if (url.pathname.endsWith('/api/consensus/health')) {
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"ready":false}' });
    }
    if (/fonts\.(googleapis|gstatic)\.com|challenges\.cloudflare\.com/.test(url.hostname)) return route.abort();
    return route.continue();
  });
  return context;
}

async function open(page, name) {
  await page.goto(base + '/' + name, { waitUntil: 'load' });
  // Preserve the existing production start-at-top protection during acceptance.
  await page.waitForTimeout(1600);
}
async function click(page, selector) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  await target.click({ timeout: 15000 });
}
async function capture(page, selector, name) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: path.join(OUT, name + '.png') });
  report.screenshots.push(name + '.png');
}
async function snapshot(page) {
  return page.locator('[data-cycle]').evaluate(root => {
    const text = id => root.querySelector('#' + id)?.textContent.trim() || '';
    const next = root.querySelector('#cycleNext');
    return { identity: root.querySelector('.cycle-id')?.textContent.trim(), state: root.dataset.state,
      selected: [...root.querySelectorAll('[data-cycle-step][aria-pressed="true"]')].map(b => b.dataset.cycleStep),
      version: text('cycleVersion'), terms: text('cycleTerms'), approval: text('cycleApproval'),
      publication: text('cyclePublication'), outcome: text('cycleOutcome'), status: text('cycleStatus'),
      result: text('cycleResult'), next: next?.textContent.trim(), nextDisabled: !!next?.disabled,
      history: [...root.querySelectorAll('#cycleHistory li')].map(li => li.textContent.trim()) };
  });
}

const approvalValid = s => !/未承認|合意前|失効|無効|取り消|承認待ち/.test(s.approval) && /承認|合意/.test(s.approval);
const publicationPending = s => /未確認|要求|待ち|確認中|不明/.test(s.publication);
const publicationConfirmed = s => !/未実行|未公開|未確認|待ち|不明|停止/.test(s.publication) && /公開|配信/.test(s.publication);
const stoppedConfirmed = s => !/未確認|要求|待ち|不明/.test(s.publication) && /停止/.test(s.publication);
const publicRequests = s => s.history.filter(item => /公開|配信/.test(item) && /要求|依頼|リクエスト/.test(item)).length;

async function reset(page, label) {
  await click(page, '[data-cycle-action="reset"]');
  const s = await snapshot(page);
  check(label + ': reset restores an unapproved and unexecuted case',
    !approvalValid(s) && /未実行|未公開/.test(s.publication) && /未取得|未確定/.test(s.outcome) && /v1/.test(s.version), s);
  return s;
}

async function reachPublication(page, label, confirm = true) {
  await reset(page, label);
  await click(page, '#cycleNext');
  const review = await snapshot(page);
  check(label + ': entering review does not itself approve or publish', !approvalValid(review) && !publicationConfirmed(review), review);
  await click(page, '#cycleNext');
  const approved = await snapshot(page);
  check(label + ': approval is visibly bound to the current material', approvalValid(approved) && /v1/.test(approved.version) && !publicationConfirmed(approved), approved);
  await click(page, '#cycleNext');
  const requested = await snapshot(page);
  check(label + ': publication request is pending, not confirmed', publicationPending(requested) && !publicationConfirmed(requested), requested);
  if (!confirm) return requested;
  await click(page, '#cycleNext');
  const published = await snapshot(page);
  check(label + ': separate result confirmation establishes publication', publicationConfirmed(published), published);
  return published;
}

async function cycleJourney(page, label) {
  const initial = await reset(page, label);
  check(label + ': explicit sample boundary', /見本/.test(await page.locator('[data-cycle]').innerText()) &&
    /公開・契約・支払いは実行されません/.test(await page.locator('[data-cycle]').innerText()));
  check(label + ': five labeled stages', await page.locator('[data-cycle-step]').count() === 5);

  // Viewing the final stage must not bypass actual simulated state transitions.
  await click(page, '[data-cycle-step="4"]');
  let s = await snapshot(page);
  check(label + ': viewing a future stage does not approve or execute', !approvalValid(s) && !publicationConfirmed(s), s);
  if (!s.nextDisabled) {
    await click(page, '#cycleNext');
    s = await snapshot(page);
    check(label + ': future-stage view cannot bypass prerequisites',
      !approvalValid(s) && !publicationConfirmed(s) && /未取得|未確定/.test(s.outcome), s);
  }
  await reset(page, label);
  await page.locator('#cycleNext').focus();
  await page.locator('#cycleNext').press('Enter');
  s = await snapshot(page);
  check(label + ': keyboard activates the next stage', s.selected.includes('1') && !approvalValid(s), s);

  const published = await reachPublication(page, label + '/complete');
  await click(page, '#cycleNext');
  s = await snapshot(page);
  check(label + ': results are acquired before statement confirmation', !/未取得/.test(s.outcome) && /未確定|確認|明細/.test(s.outcome), s);
  await click(page, '#cycleNext');
  s = await snapshot(page);
  // 「照合済み」も明細確認の完了を明示する。語の違いだけで落とさず、
  // complete 状態と未取得・未確定の排除は必要条件とする。支払いの完了は意味しない。
  check(label + ': statement completion is explicit', s.state === 'complete' &&
    !/未確定|未取得/.test(s.outcome) && /確定|完了|照合済み/.test(s.outcome + s.status), s);
  check(label + ': same case across the full cycle', initial.identity && s.identity === initial.identity && published.identity === initial.identity);
  check(label + ': actions have reviewable history', s.history.length >= 6, s.history);
  await capture(page, '[data-cycle]', label + '-completed');

  for (const action of ['asset', 'terms']) {
    await reachPublication(page, label + '/' + action, false);
    // Reconcile the pending publication before testing a changed, public case.
    await click(page, '#cycleNext');
    const before = await snapshot(page);
    await click(page, `[data-cycle-action="${action}"]`);
    const changed = await snapshot(page);
    check(label + ': ' + action + ' changes the relevant fact',
      action === 'asset' ? changed.version !== before.version : changed.terms !== before.terms, changed);
    check(label + ': ' + action + ' invalidates approval', !approvalValid(changed), changed);
    check(label + ': ' + action + ' requests old-publication stop without claiming completion',
      publicationPending(changed) && /停止/.test(changed.publication + changed.result), changed);
    const oldRequests = publicRequests(changed);
    await click(page, '#cycleNext');
    const stopped = await snapshot(page);
    check(label + ': ' + action + ' confirms stop before any fresh publication',
      stoppedConfirmed(stopped) && publicRequests(stopped) === oldRequests, stopped);
    check(label + ': stopping does not restore old approval', !approvalValid(stopped), stopped);
    if (action === 'asset') await capture(page, '[data-cycle]', label + '-changed');
  }

  await reachPublication(page, label + '/expiry');
  await click(page, '[data-cycle-action="expire"]');
  s = await snapshot(page);
  check(label + ': expiry is a pending stop', /停止/.test(s.publication + s.result) && publicationPending(s) && !approvalValid(s), s);
  await click(page, '#cycleNext');
  s = await snapshot(page);
  check(label + ': expiry completes only on stop confirmation', stoppedConfirmed(s), s);
  const expiredStopped = s;
  check(label + ': expired rights remain blocked after stop confirmation',
    s.nextDisabled && /期限/.test(s.status) && /条件/.test(s.next) && !approvalValid(s), s);

  // 素材の差し替えは利用期限の更新ではない。停止済みでも新しい素材だけで再開できてはならない。
  await click(page, '[data-cycle-action="asset"]');
  const expiredReplacement = await snapshot(page);
  check(label + ': replacing an expired asset does not renew its rights',
    expiredReplacement.version !== expiredStopped.version && expiredReplacement.terms === expiredStopped.terms &&
    expiredReplacement.nextDisabled && /期限/.test(expiredReplacement.status) &&
    stoppedConfirmed(expiredReplacement) && !approvalValid(expiredReplacement) &&
    publicRequests(expiredReplacement) === publicRequests(expiredStopped), expiredReplacement);

  // 条件を明示的に更新しても自動承認・再公開にはせず、改めて人の承認を要求する。
  await click(page, '[data-cycle-action="terms"]');
  const renewedTerms = await snapshot(page);
  check(label + ': explicit terms update enables fresh review without approval',
    renewedTerms.terms !== expiredReplacement.terms && !/期限到来/.test(renewedTerms.terms) &&
    !renewedTerms.nextDisabled && !approvalValid(renewedTerms) && stoppedConfirmed(renewedTerms) &&
    publicRequests(renewedTerms) === publicRequests(expiredStopped), renewedTerms);
  await click(page, '#cycleNext');
  const renewedApproval = await snapshot(page);
  check(label + ': renewed terms require and receive a fresh approval before any new publication',
    approvalValid(renewedApproval) && renewedApproval.approval.includes(renewedApproval.version) &&
    stoppedConfirmed(renewedApproval) && publicRequests(renewedApproval) === publicRequests(expiredStopped), renewedApproval);

  const request = await reachPublication(page, label + '/network', false);
  check(label + ': publication request has a visible history entry', publicRequests(request) >= 1, request.history);
  await click(page, '[data-cycle-action="network"]');
  const unknown = await snapshot(page);
  check(label + ': interrupted request keeps an unknown outcome',
    /不明|未確認/.test(unknown.publication + unknown.outcome + unknown.result) && !publicationConfirmed(unknown), unknown);
  check(label + ': interrupted request is not duplicated', publicRequests(unknown) === publicRequests(request), unknown.history);
  await click(page, '#cycleNext');
  const resolved = await snapshot(page);
  check(label + ': reconciliation confirms the existing request', publicationConfirmed(resolved) && publicRequests(resolved) === publicRequests(request), resolved);
  await reset(page, label + '/final');
}

const PRICE_CASES = [
  { n: 30, m: 60, w: 5000, cost: 150000, fee: 62500, category: 'reachable', minutes: 25 },
  { n: 30, m: 25, w: 5000, cost: 62500, fee: 62500, category: 'equal', minutes: 25 },
  { n: 30, m: 20, w: 5000, cost: 50000, fee: 62500, category: 'unreachable', minutes: 25 },
  { n: 65, m: 20, w: 5000, cost: 108333.33333333333, fee: 106250, category: 'reachable', minutes: 19.615384615384617 },
  { n: 20, m: 60, w: 5000, cost: 100000, fee: 50000, category: 'reachable', minutes: 30 },
  { n: 25, m: 60, w: 5000, cost: 125000, fee: 56250, category: 'reachable', minutes: 27 },
];
async function setRange(page, selector, value) {
  const input = page.locator(selector);
  const min = Number(await input.getAttribute('min')), step = Number(await input.getAttribute('step') || 1);
  const count = (value - min) / step;
  if (!Number.isInteger(count) || count < 0) throw new Error('Test value is not reachable through the range control: ' + selector);
  await input.scrollIntoViewIfNeeded();
  await input.press('Home');
  for (let i = 0; i < count; i++) await input.press('ArrowRight');
  check(selector + ': keyboard-selected value ' + value, await input.inputValue() === String(value));
}
function amount(text) {
  const match = /([\d,]+)円/.exec(text);
  return match ? Number(match[1].replaceAll(',', '')) : NaN;
}
async function priceJourney(page, label) {
  for (const expected of PRICE_CASES) {
    await setRange(page, '#gainN', expected.n);
    await setRange(page, '#gainM', expected.m);
    await setRange(page, '#gainW', expected.w);
    const actual = await page.locator('[data-gain]').evaluate(root => ({
      cost: root.querySelector('#gainNow').textContent.trim(), fee: root.querySelector('#gainFee').textContent.trim(),
      threshold: root.querySelector('#gainEven').textContent.trim(),
    }));
    const id = label + '/price ' + expected.n + '×' + expected.m + '×' + expected.w;
    check(id + ': current cost', Math.abs(amount(actual.cost) - expected.cost) <= 0.51, actual);
    check(id + ': published fee', amount(actual.fee) === expected.fee, actual);
    const saysImpossible = /届きません|届かない|回収できません|回収できない|足りません|超えます|上回ります/.test(actual.threshold);
    if (expected.category === 'equal') {
      check(id + ': equality is distinguished from impossibility', !saysImpossible && /同額|等しい|すべて|全て/.test(actual.threshold), actual);
      await capture(page, '[data-gain]', label + '-price-equality');
    } else if (expected.category === 'unreachable') {
      check(id + ': genuinely insufficient time is identified', saysImpossible, actual);
    } else {
      const minutes = Number(/([\d.]+)\s*分/.exec(actual.threshold)?.[1]);
      check(id + ': reachable threshold including rounding boundary', !saysImpossible && Number.isFinite(minutes) &&
        minutes >= expected.minutes - 0.11 && minutes <= Math.ceil(expected.minutes), actual);
    }
    report.cases.push({ browser: label, expected, actual });
  }
  check(label + ': estimate is not claimed as measured savings', /試算/.test(await page.locator('.gain-disclosure').innerText()) &&
    /実際の削減効果を示すものではありません/.test(await page.locator('.gain-disclosure').innerText()));
}

async function layoutChecks(page, label) {
  for (const selector of ['[data-cycle]', '[data-gain]', '.offer-scope']) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    check(label + ': no horizontal overflow at ' + selector,
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  const controls = await page.locator('[data-cycle] button, [data-gain] input[type="range"]').evaluateAll(elements =>
    elements.filter(el => el.getClientRects().length).map(el => {
      const r = el.getBoundingClientRect(); return { text: el.textContent.trim() || el.id, width: r.width, height: r.height };
    }));
  check(label + ': new interactive targets at least 44px', controls.length >= 12 && controls.every(r => r.width >= 44 && r.height >= 44), controls);
  await page.locator('#cycleNext').focus();
  check(label + ': keyboard focus is visible', await page.locator('#cycleNext').evaluate(el => {
    const s = getComputedStyle(el); return document.activeElement === el &&
      ((s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none');
  }));
  check(label + ': case detail announces changes', await page.locator('.cycle-detail').getAttribute('aria-live') === 'polite');
}

async function mediaJourney(page, name, label, reducedMotion = false) {
  await open(page, name);
  const videos = page.locator('video[data-editorial-video]');
  check(label + '/' + name + ': editorial media exists', await videos.count() > 0);
  for (let i = 0; i < await videos.count(); i++) {
    const video = videos.nth(i), toggle = page.locator('[data-editorial-toggle]').nth(i);
    await video.scrollIntoViewIfNeeded();
    const initial = await video.evaluate(el => ({ poster: el.poster, muted: el.muted, inline: el.playsInline, autoplay: el.autoplay,
      paused: el.paused, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
    check(label + '/' + name + ': useful still and silent inline media', !!initial.poster && initial.muted && initial.inline && initial.width > 0 && initial.height > 0, initial);
    const decoded = await page.evaluate(async src => {
      const img = new Image(); img.src = src;
      try { await img.decode(); return { width: img.naturalWidth, height: img.naturalHeight }; }
      catch { return { width: 0, height: 0 }; }
    }, initial.poster);
    check(label + '/' + name + ': poster is actually decodable', decoded.width >= 640 && decoded.height > 0, decoded);
    if (reducedMotion) {
      check(label + '/' + name + ': reduced motion has no automatic playback', initial.paused && !initial.autoplay, initial);
    }
    const size = await toggle.boundingBox();
    check(label + '/' + name + ': media control is visible and touchable', await toggle.isVisible() && !!size && size.width >= 44 && size.height >= 44, size);
    if (!(await video.evaluate(el => el.paused))) {
      await toggle.click();
      await page.waitForFunction(index => document.querySelectorAll('video[data-editorial-video]')[index].paused, i);
    }
    check(label + '/' + name + ': explicit pause is real', await video.evaluate(el => el.paused));
    await toggle.click();
    await page.waitForFunction(index => {
      const v = document.querySelectorAll('video[data-editorial-video]')[index];
      return !v.paused && v.readyState >= 2 && v.currentTime > 0;
    }, i, { timeout: 15000 });
    check(label + '/' + name + ': user play decodes actual video', await video.evaluate(el => !el.paused && el.videoWidth > 0 && el.currentTime > 0));
    await toggle.click();
    await page.waitForFunction(index => document.querySelectorAll('video[data-editorial-video]')[index].paused, i);
    check(label + '/' + name + ': pause after playback works', await video.evaluate(el => el.paused));
    check(label + '/' + name + ': media caption does not claim client work', /イメージ映像/.test(await page.locator('body').innerText()));
    check(label + '/' + name + ': media introduces no horizontal overflow',
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(OUT, label + '-' + name + '-media.png') });
    report.screenshots.push(label + '-' + name + '-media.png');
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  try {
    if (!base) {
      server = http.createServer(serve);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      base = 'http://127.0.0.1:' + server.address().port;
    }
    base = base.replace(/\/$/, '');
    const chrome = await chromium.launch(); browsers.push(chrome);
    const safari = await webkit.launch(); browsers.push(safari);
    for (const [label, browser, options] of [
      ['chromium-1440', chrome, { viewport: { width: 1440, height: 900 } }],
      ['chromium-390', chrome, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
      ['webkit-390', safari, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ]) {
      const context = await contextFor(browser, options), page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      const run = async (name, action) => {
        try { await action(); }
        catch (error) { report.fails.push(label + '/' + name + ': journey interrupted: ' + String(error.stack || error)); }
      };
      try {
        await open(page, 'creative');
        await run('cycle', () => cycleJourney(page, label));
        await run('price', () => priceJourney(page, label));
        await run('layout', () => layoutChecks(page, label));
        await run('enterprise media', () => mediaJourney(page, 'creative', label));
        await run('creator media', () => mediaJourney(page, 'creator', label));
        check(label + ': no JavaScript errors', errors.length === 0, errors);
      } catch (error) { report.fails.push(label + ': journey interrupted: ' + String(error.stack || error)); }
      finally { await context.close(); }
      report.browsers.push(label);
    }
    const context = await contextFor(chrome, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const reduced = async (name, action) => {
      try { await action(); }
      catch (error) { report.fails.push('reduced-390/' + name + ': journey interrupted: ' + String(error.stack || error)); }
    };
    try {
      await open(page, 'creative');
      await reduced('cycle', () => cycleJourney(page, 'reduced-390'));
      await reduced('enterprise media', () => mediaJourney(page, 'creative', 'reduced-390', true));
      await reduced('creator media', () => mediaJourney(page, 'creator', 'reduced-390', true));
    } catch (error) { report.fails.push('reduced-390: journey interrupted: ' + String(error.stack || error)); }
    finally { await context.close(); }
    check('all sample journeys attempted no external mutation', report.mutationRequests.length === 0, report.mutationRequests);
  } catch (error) { report.fails.push('acceptance did not finish: ' + String(error.stack || error)); }
  finally {
    for (const browser of browsers) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (report.fails.length) process.exitCode = 1;
  }
})();
