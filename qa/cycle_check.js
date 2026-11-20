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

  for (const action of ['asset', 'terms']) {
    await click(page, `[data-cycle-action="${action}"]`);
    const edit = await snapshot(page);
    check(label + ': ' + action + ' before first approval stays unapproved',
      edit.approval === '未承認' && edit.selected.includes('1') && /未承認/.test(edit.result)
      && !/失効|再承認/.test(edit.status + edit.result + edit.history.join('')) && publicRequests(edit) === 0, edit);
  }
  await click(page, '[data-cycle-step="2"]');
  await click(page, '#cycleNext');
  const gated = await snapshot(page);
  check(label + ': publication routes an unapproved revision to review',
    gated.selected.includes('1') && !approvalValid(gated) && publicRequests(gated) === 0, gated);
  await click(page, '#cycleNext');
  const revisedApproval = await snapshot(page);
  check(label + ': first approval binds the edited asset and terms',
    approvalValid(revisedApproval) && revisedApproval.approval.includes('v2・条件版 2'), revisedApproval);
  await click(page, '[data-cycle-action="asset"]');
  const revoked = await snapshot(page);
  check(label + ': changing the approved draft invalidates it before publication',
    /失効/.test(revoked.result) && /失効/.test(revoked.approval)
    && /失効/.test(revoked.history.at(-1)) && publicRequests(revoked) === 0, revoked);
  await click(page, '[data-cycle-action="terms"]');
  const subsequent = await snapshot(page);
  check(label + ': a further change cannot invalidate the same approval twice',
    !approvalValid(subsequent) && /未承認/.test(subsequent.result) && !/失効/.test(subsequent.result)
    && /未承認/.test(subsequent.history.at(-1)) && subsequent.history.filter(event => event.includes('失効')).length === 1
    && publicRequests(subsequent) === 0, subsequent);

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
    if (action === 'asset') {
      const preview = page.locator('#cyclePreview');
      check(label + ': asset change uses the new CG poster and its description',
        await preview.getAttribute('src') === 'assets/editorial/creative-study-v1.webp'
        && await page.locator('#cycleMediaCaption').innerText() === '構図と光のCG');
      await capture(page, '[data-cycle]', label + '-changed');
    }
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
  for (const selector of ['[data-cycle]', '[data-gain]', '#services']) {
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
    const video = videos.nth(i), region = page.locator('[data-editorial]').nth(i);
    const toggle = region.locator('[data-editorial-toggle]');
    await region.scrollIntoViewIfNeeded();
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
    const playing = () => page.waitForFunction(index => {
      const v = document.querySelectorAll('video[data-editorial-video]')[index];
      return !v.paused && v.readyState >= 2 && v.currentTime > 0;
    }, i, { timeout: 15000 });
    // Wait for a real initial state before issuing an action by its visible label.
    // Reading paused and later blindly toggling races with IntersectionObserver.
    if (reducedMotion) await region.getByRole('button', { name: '映像を再生', exact: true }).click();
    await playing();
    check(label + '/' + name + ': initial visible playback decodes actual video',
      await video.evaluate(el => !el.paused && el.videoWidth > 0 && el.currentTime > 0));
    // The film itself can leave the viewport while its large copy section is
    // still visible. This must stop an active decoder without a pause click.
    await video.evaluate(el => {
      window.scrollTo({ top: scrollY + el.getBoundingClientRect().bottom + 12, behavior: 'instant' });
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const outside = await region.evaluate(root => {
      const v = root.querySelector('video[data-editorial-video]');
      const film = v.getBoundingClientRect(), section = root.getBoundingClientRect();
      return { videoTop: film.top, videoBottom: film.bottom, sectionTop: section.top,
        sectionBottom: section.bottom, viewport: innerHeight, paused: v.paused, time: v.currentTime };
    });
    check(label + '/' + name + ': video is outside while its copy section remains visible',
      outside.videoBottom <= 0 && outside.sectionBottom > 0 && outside.sectionTop < outside.viewport, outside);
    await page.waitForFunction(index => document.querySelectorAll('video[data-editorial-video]')[index].paused,
      i, { timeout: 5000 });
    check(label + '/' + name + ': leaving the video viewport automatically pauses playback',
      await video.evaluate(el => el.paused));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const stoppedAt = await video.evaluate(el => el.currentTime);
    await page.waitForTimeout(250);
    const stopped = await video.evaluate(el => ({ paused: el.paused, time: el.currentTime }));
    check(label + '/' + name + ': offscreen playback time remains stopped',
      stopped.paused && Math.abs(stopped.time - stoppedAt) <= 0.01, { stoppedAt, stopped });
    report.cases.push({ id: label + '/' + name + '/video-visibility', outside, stoppedAt, stopped });
    await region.scrollIntoViewIfNeeded();
    if (reducedMotion) {
      // Re-entry is not another user play request when reduced motion is set.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForTimeout(250);
      check(label + '/' + name + ': reduced motion does not restart on re-entry',
        await video.evaluate(el => el.paused));
      await region.getByRole('button', { name: '映像を再生', exact: true }).click();
      await playing();
    } else {
      await page.waitForFunction(({ index, time }) => {
        const v = document.querySelectorAll('video[data-editorial-video]')[index];
        return !v.paused && v.readyState >= 2 && Math.abs(v.currentTime - time) > 0.02;
      }, { index: i, time: stopped.time }, { timeout: 15000 });
      check(label + '/' + name + ': normal re-entry automatically resumes decoded playback',
        await video.evaluate((el, time) => !el.paused && Math.abs(el.currentTime - time) > 0.02, stopped.time));
    }
    await region.getByRole('button', { name: '一時停止', exact: true }).click();
    await page.waitForFunction(index => document.querySelectorAll('video[data-editorial-video]')[index].paused, i);
    check(label + '/' + name + ': explicit pause is real', await video.evaluate(el => el.paused));
    // A deliberate stop must survive viewport exit and re-entry.
    await page.locator('h1').scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await region.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(label + '/' + name + ': manual pause survives re-entry', await video.evaluate(el => el.paused));
    await region.getByRole('button', { name: '映像を再生', exact: true }).click();
    await playing();
    check(label + '/' + name + ': user play decodes actual video', await video.evaluate(el => !el.paused && el.videoWidth > 0 && el.currentTime > 0));
    await region.getByRole('button', { name: '一時停止', exact: true }).click();
    await page.waitForFunction(index => document.querySelectorAll('video[data-editorial-video]')[index].paused, i);
    check(label + '/' + name + ': pause after playback works', await video.evaluate(el => el.paused));
    check(label + '/' + name + ': media caption does not claim client work', /イメージ映像/.test(await page.locator('body').innerText()));
    check(label + '/' + name + ': media introduces no horizontal overflow',
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(OUT, label + '-' + name + '-media.png') });
    report.screenshots.push(label + '-' + name + '-media.png');
  }
}

async function editorialPosterJourney(browser) {
  const context = await contextFor(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const moviePath = '/assets/editorial/creative-study-v1.mp4';
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(url => url.pathname.endsWith(moviePath), async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (new URL(route.request().url()).searchParams.has('qa-media-error')) return route.fulfill({ status: 503, body: '' });
    await gate;
    return route.fallback();
  });
  const posterVisible = visible => page.waitForFunction(expected => {
    const img = document.querySelector('#show img.editorial-poster'), video = document.querySelector('#show video');
    if (!img || !img.complete || img.naturalWidth < 640 || img.currentSrc !== video.poster) return false;
    const style = getComputedStyle(img), r = img.getBoundingClientRect();
    const shown = style.visibility === 'visible' && Number(style.opacity) > 0 && r.width > 0 && r.height > 0;
    if (!expected) return !shown;
    const film = video.getBoundingClientRect();
    return shown && Math.abs(r.left - film.left) <= 1 && Math.abs(r.top - film.top) <= 1
      && Math.abs(r.width - film.width) <= 1 && Math.abs(r.height - film.height) <= 1;
  }, visible, { timeout: 15000 });
  try {
    await open(page, 'creative');
    const video = page.locator('#show video');
    await Promise.all([
      page.waitForRequest(r => r.method() === 'GET' && new URL(r.url()).pathname.endsWith(moviePath), { timeout: 15000 }),
      video.scrollIntoViewIfNeeded(),
    ]);
    await posterVisible(true);
    check('WebKit: matching poster covers the film while the request is pending', await video.evaluate(v => v.readyState < 2));
    release();
    await page.waitForFunction(() => {
      const v = document.querySelector('#show video');
      return !v.paused && v.videoWidth > 0 && v.currentTime > 0;
    }, null, { timeout: 15000 });
    await posterVisible(false);
    check('WebKit: decoded playback replaces the poster', await video.evaluate(v => v.readyState >= 2));
    await video.evaluate(v => {
      const url = new URL(v.currentSrc);
      url.searchParams.set('qa-media-error', '1');
      v.src = url.href;
      v.load();
    });
    await page.waitForFunction(() => !!document.querySelector('#show video').error, null, { timeout: 15000 });
    await posterVisible(true);
    check('WebKit: a failed media request restores the poster', await page.locator('#show [data-editorial-toggle]').isDisabled());
  } catch (error) {
    await recordFailure(page, 'webkit-390', 'editorial-poster', error);
  } finally {
    release();
    await context.close();
  }
}

async function slowMediaReplay(browser) {
  // Real Chromium, decoder and user clicks. Only the MP4 transport is delayed.
  // Reduced motion keeps automatic playback out of this rapid-input regression.
  const context = await contextFor(browser, { viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.route('**/assets/editorial/*.mp4', async route => {
    if (route.request().method() !== 'GET') {
      report.mutationRequests.push({ url: route.request().url(), method: route.request().method() });
      return route.abort();
    }
    await new Promise(resolve => setTimeout(resolve, 1800));
    await route.continue();
  });
  const page = await context.newPage(), states = [];
  try {
    await open(page, 'creative');
    const video = page.locator('video[data-editorial-video]').first();
    const button = page.locator('[data-editorial-toggle]').first();
    await button.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = async stage => {
      const value = await video.evaluate(v => ({ paused: v.paused, readyState: v.readyState, time: v.currentTime }));
      states.push({ stage, ...value }); return value;
    };
    check('slow mobile media: starts paused without an autoplay request',
      (await state('before input')).paused && !(await video.getAttribute('src')));
    const box = await button.boundingBox();
    if (!box) throw new Error('Slow media control is not visible');
    const press = () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await press();
    check('slow mobile media: first request starts before decoding',
      !(await state('play')).paused && states.at(-1).readyState < 2);
    await press();
    check('slow mobile media: stop interrupts the pending request', (await state('pause')).paused);
    await press();
    await state('replay');
    await page.waitForFunction(() => {
      const v = document.querySelector('video[data-editorial-video]');
      return !v.paused && v.readyState >= 2 && v.currentTime > 0;
    }, null, { timeout: 15000 });
    const final = await state('decoded');
    check('slow mobile media: latest replay is not lost', !final.paused && final.time > 0);
    await page.getByRole('button', { name: '一時停止', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video[data-editorial-video]').paused);
    check('slow mobile media: final explicit stop wins', (await state('final stop')).paused);
  } catch (error) {
    await recordFailure(page, 'chromium-390', 'slow-media-replay', error);
  } finally {
    report.cases.push({ id: 'chromium-390/slow-media-replay', states });
    await context.close();
  }
}

async function recordFailure(page, label, name, error) {
  report.fails.push(label + '/' + name + ': journey interrupted: ' + String(error.stack || error));
  const file = (label + '-' + name).replace(/[^a-zA-Z0-9_-]/g, '-') + '-failure.png';
  try { await page.screenshot({ path: path.join(OUT, file) }); report.screenshots.push(file); } catch (_) { /* Keep the original failure. */ }
  try {
    const media = await page.locator('[data-editorial]').evaluateAll(regions => regions.map(root => {
      const v = root.querySelector('video'), b = root.querySelector('button');
      return { paused: v?.paused, readyState: v?.readyState, currentTime: v?.currentTime,
        error: v?.error?.message || null, button: b?.textContent, pressed: b?.getAttribute('aria-pressed') };
    }));
    report.cases.push({ id: label + '/' + name, mediaAtFailure: media });
  } catch (_) { /* Keep the original failure even if its page has closed. */ }
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
        catch (error) { await recordFailure(page, label, name, error); }
      };
      try {
        await open(page, 'creative');
        await run('cycle', () => cycleJourney(page, label));
        await run('price', () => priceJourney(page, label));
        await run('layout', () => layoutChecks(page, label));
        await run('enterprise media', () => mediaJourney(page, 'creative', label));
        // The Creator page carries no film: its income section leads straight into the six entries.
        await open(page, 'creator');
        check(label + ': creator page shows no editorial film', await page.locator('[data-editorial], video').count() === 0);
        check(label + ': creator income section leads into the six entries',
          await page.locator('#income .head .lead').count() === 1 && await page.locator('#income .income-choice').count() === 6);
        check(label + ': no JavaScript errors', errors.length === 0, errors);
      } catch (error) { report.fails.push(label + ': journey interrupted: ' + String(error.stack || error)); }
      finally { await context.close(); }
      report.browsers.push(label);
    }
    const context = await contextFor(chrome, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const reduced = async (name, action) => {
      try { await action(); }
      catch (error) { await recordFailure(page, 'reduced-390', name, error); }
    };
    try {
      await open(page, 'creative');
      await reduced('cycle', () => cycleJourney(page, 'reduced-390'));
      await reduced('enterprise media', () => mediaJourney(page, 'creative', 'reduced-390', true));
    } catch (error) { report.fails.push('reduced-390: journey interrupted: ' + String(error.stack || error)); }
    finally { await context.close(); }
    await slowMediaReplay(chrome);
    await editorialPosterJourney(safari);
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
