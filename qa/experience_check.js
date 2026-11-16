// Browser acceptance for REYZ's service choices and their real destinations.
// Usage: node qa/experience_check.js site [output-directory]
// BASE/QA_BASE may point at an existing preview; QA_OUT sets the artifact parent.
// Every mutation request is intercepted. This suite never submits an inquiry.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(process.argv[2] || 'site');
const OUT = path.resolve(process.argv[3] || path.join(process.env.QA_OUT || 'qa/out', 'experience'));
const report = { checks: 0, fails: [], browsers: [], scenes: [], contacts: [], screenshots: [], mutationRequests: [] };
const launched = [];
let server;
let base = process.env.BASE || process.env.QA_BASE;

function check(label, ok, detail) {
  report.checks++;
  if (!ok) report.fails.push(label + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
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
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

async function contextFor(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', ...options });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      report.mutationRequests.push({ url: request.url(), method: request.method() });
      return route.abort();
    }
    if (url.pathname.endsWith('/api/consensus/health')) return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"ready":false}' });
    if (/fonts\.(googleapis|gstatic)\.com|challenges\.cloudflare\.com/.test(url.hostname)) return route.abort();
    return route.continue();
  });
  return context;
}

async function open(page, name) {
  await page.goto(base + '/' + (name === 'index' ? '' : name), { waitUntil: 'load' });
  // The production start-at-top guard lasts 1.5 s. Keep it active in this test.
  await page.waitForTimeout(1600);
}
async function click(locator) {
  await locator.scrollIntoViewIfNeeded();
  // No force clicks or DOM dispatch: overlays and inaccessible targets must fail.
  await locator.click({ timeout: 15000 });
}
async function canvasState(locator) {
  return locator.evaluate(canvas => {
    const ctx = canvas.getContext('2d'), { width, height } = canvas;
    if (!ctx || width < 1 || height < 1) return { width, height, samples: 0, pink: 0, hash: 0 };
    const bytes = ctx.getImageData(0, 0, width, height).data;
    let hash = 2166136261, samples = 0, pink = 0, min = 255, max = 0;
    const stride = Math.max(1, Math.floor(Math.min(width, height) / 70));
    for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4, r = bytes[i], g = bytes[i + 1], b = bytes[i + 2];
      hash = Math.imul(hash ^ r, 16777619); hash = Math.imul(hash ^ g, 16777619); hash = Math.imul(hash ^ b, 16777619);
      samples++; if (r > 60 && b > 30 && r > g * 1.5 && b > g * 1.3) pink++;
      min = Math.min(min, r, g, b); max = Math.max(max, r, g, b);
    }
    return { width, height, samples, pink, range: max - min, hash: hash >>> 0 };
  });
}
async function controlsFit(page, selector, label) {
  const sizes = await page.locator(selector).evaluateAll(elements => elements.map(el => {
    const r = el.getBoundingClientRect(); return { text: el.textContent.trim(), width: r.width, height: r.height };
  }));
  check(label + ': controls at least 44px', sizes.length > 0 && sizes.every(r => r.width >= 44 && r.height >= 44), sizes);
  check(label + ': no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}

// Layout evidence, separate from the behavioral assertions below. Capture this
// first so a later failed action does not erase the other pages' visual evidence.
async function visualSections(browser) {
  for (const [label, options] of [
    ['chromium-1440', { viewport: { width: 1440, height: 900 } }],
    ['chromium-390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ]) {
    const context = await contextFor(browser, options), page = await context.newPage();
    const capture = async (name, locator) => {
      const file = label + '-' + name + '.png';
      if (locator) await locator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      if (locator) await locator.screenshot({ path: path.join(OUT, file) });
      else await page.screenshot({ path: path.join(OUT, file) });
      report.screenshots.push(file);
    };
    try {
      await open(page, 'index');
      await capture('home-hero');
      await capture('home-structure', page.locator('#origin .copy'));
      await capture('home-company', page.locator('#reyz .copy'));
      await open(page, 'creative');
      await capture('creative-services', page.locator('#services .section-text'));
      const groups = page.locator('#services .group');
      for (let i = 0; i < await groups.count(); i++) {
        const group = groups.nth(i), summaries = group.locator('details > summary');
        for (let j = 0; j < await summaries.count(); j++) await click(summaries.nth(j));
        await capture('creative-services-' + (i + 1) + '-open', group);
      }
      await open(page, 'ai');
      await capture('ai-products', page.locator('#products .section-text'));
      await open(page, 'contact');
      await capture('contact-form', page.locator('#form .section-text'));
      await open(page, 'legal');
      await capture('legal-notices', page.locator('#notices .legal-grid'));
    } catch (error) {
      report.fails.push(label + ': visual evidence did not finish: ' + String(error.stack || error));
    } finally { await context.close(); }
  }
}

async function creatorChoices(page, label) {
  await open(page, 'creator');
  const expected = [
    ['live', '#services'], ['product', '#model'], ['campaign', '#model'],
    ['direct', '#model'], ['media', '#model'], ['ip', '#services'],
  ];
  const canvas = page.locator('.income-canvas'), signatures = [];
  check(label + ': all six income choices remain visible content', await page.locator('.income-choice').count() === 6);
  for (const [id, destination] of expected) {
    await click(page.locator('.income-choice[data-income="' + id + '"]'));
    check(label + ': ' + id + ' is the single selected choice',
      await page.locator('.income-choice[aria-pressed="true"]').count() === 1
      && await page.locator('.income-choice[data-income="' + id + '"]').getAttribute('aria-pressed') === 'true');
    await canvas.scrollIntoViewIfNeeded();
    // Compare the completed routes, not incidental positions of travelling dots.
    await page.waitForTimeout(1550);
    const pixels = await canvasState(canvas); signatures.push(pixels.hash);
    check(label + ': ' + id + ' has a rendered route', pixels.samples > 100 && pixels.range > 50, pixels);
    const next = page.locator('.income-next');
    check(label + ': ' + id + ' links to the relevant explanation', new URL(await next.getAttribute('href'), page.url()).hash === destination);
    await click(next);
    await page.waitForFunction(hash => location.hash === hash, destination);
    check(label + ': ' + id + ' CTA navigates', new URL(page.url()).hash === destination);
    await page.waitForFunction(id => {
      const r = document.querySelector(id).getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0;
    }, destination);
  }
  check(label + ': six selections produce six different rendered routes', new Set(signatures).size === 6, signatures);
  await click(page.locator('.income-choice[data-income="live"]'));
  await page.keyboard.press('Tab'); await page.keyboard.press('Space');
  check(label + ': keyboard can select the next route', await page.locator('.income-choice[data-income="product"]').getAttribute('aria-pressed') === 'true');
  await controlsFit(page, '.income-choice, .income-next', label + ' creator');
  await page.locator('[data-income-experience]').screenshot({ path: path.join(OUT, label + '-creator.png') });
}

async function cinematicChoices(page, label) {
  await open(page, 'creative');
  await click(page.locator('.hero-action[href="#show"]'));
  const figure = page.locator('[data-cinematic]'), canvas = page.locator('.cinematic-canvas');
  const scrub = page.locator('.cinematic-scrub'), toggle = page.locator('.cinematic-toggle');
  await page.waitForFunction(() => document.querySelector('[data-cinematic]').dataset.material === 'ribbon');
  const signatures = [];
  for (const id of ['awareness', 'trust', 'action']) {
    await click(page.locator('.type-choice[data-scene="' + id + '"]'));
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => Number(document.querySelector('.cinematic-scrub').value) > 2);
    check(label + ': ' + id + ' is the single selected composition',
      await page.locator('.type-choice[aria-pressed="true"]').count() === 1
      && await page.locator('.type-choice[data-scene="' + id + '"]').getAttribute('aria-pressed') === 'true');
    check(label + ': ' + id + ' sequence is playing', await toggle.textContent() === '一時停止');
    await click(toggle);
    const stopped = await scrub.inputValue(); await page.waitForTimeout(180);
    check(label + ': ' + id + ' stops at the chosen time', await toggle.textContent() === '再生する' && await scrub.inputValue() === stopped);
    await scrub.focus(); await scrub.press('Home');
    const beginning = await canvasState(canvas);
    check(label + ': ' + id + ' keyboard seek reaches the start', await scrub.inputValue() === '0' && await figure.getAttribute('data-phase') === '1');
    const track = await scrub.boundingBox();
    await scrub.click({ position: { x: track.width * 0.5, y: track.height * 0.5 } });
    const middle = Number(await scrub.inputValue());
    check(label + ': ' + id + ' pointer seek changes the timeline', middle >= 40 && middle <= 60 && await figure.getAttribute('data-phase') === '2', middle);
    await scrub.press('End');
    const end = await canvasState(canvas); signatures.push(end.hash);
    check(label + ': ' + id + ' end differs from its first composition', end.hash !== beginning.hash, { beginning: beginning.hash, end: end.hash });
    check(label + ': ' + id + ' visibly contains the rendered ribbon', end.pink / end.samples > 0.01, end);
    check(label + ': ' + id + ' final phrase and replay control are available',
      await figure.getAttribute('data-phase') === '3' && await toggle.textContent() === 'もう一度再生');
    await page.locator('.showcase').screenshot({ path: path.join(OUT, label + '-' + id + '.png') });
    report.scenes.push({ browser: label, id, ...end });
    await click(toggle);
    await page.waitForFunction(() => {
      const value = Number(document.querySelector('.cinematic-scrub').value); return value > 2 && value < 95;
    });
    check(label + ': ' + id + ' can replay after reaching the end', await toggle.textContent() === '一時停止');
  }
  check(label + ': the three purposes have distinct visible compositions', new Set(signatures).size === 3, signatures);
  await controlsFit(page, '.type-choice, .cinematic-toggle, .cinematic-scrub', label + ' creative');
}

async function panelDestinations(page, label) {
  // Stay on the same page: changing the anchor must also change a previous tab.
  await click(page.locator('.hero-action[data-open-check]'));
  check(label + ': hero check action opens the check panel', await page.locator('#deP2').isVisible() && new URL(page.url()).hash === '#decide');
  const mapAsk = page.locator('.ask').filter({ has: page.locator('a[data-open-map]') });
  await click(mapAsk.locator('summary')); await click(mapAsk.locator('a[data-open-map]'));
  check(label + ': map action returns from check to the map panel', await page.locator('#deP1').isVisible() && await page.locator('#deT1').getAttribute('aria-selected') === 'true');
  const checkAsk = page.locator('.ask').filter({ has: page.locator('a[data-open-check]') });
  await click(checkAsk.locator('summary')); await click(checkAsk.locator('a[data-open-check]'));
  check(label + ': issue-specific check action returns to check', await page.locator('#deP2').isVisible() && await page.locator('#deT2').getAttribute('aria-selected') === 'true');
}

async function createMap(page, who) {
  await open(page, 'index');
  const answers = who === 'creator'
    ? [['who', 'all', 'creator'], ['goal', 'creator', 'yes'], ['place', 'creator', 'yes'], ['style', 'creator', 'live'], ['make', 'creator', 'share'], ['value', 'creator', 'last']]
    : [['who', 'all', 'company'], ['goal', 'company', 'no'], ['focus', 'company', 'ops'], ['first', 'company', 'speed']];
  for (const [q, audience, value] of answers) await click(page.locator('.mq[data-q="' + q + '"][data-for="' + audience + '"] .opt[data-v="' + value + '"]'));
  await page.locator('#mapCard').waitFor({ state: 'visible' });
  const map = await page.evaluate(() => ({
    goal: document.getElementById('mapGoal').textContent.trim(),
    place: document.getElementById('mapPlace').textContent.trim(),
    step: document.getElementById('mapStep').textContent.trim(),
  }));
  await click(page.locator('#mapScreens'));
  await page.waitForURL(url => new RegExp(who === 'creator' ? '/creator' : '/creative').test(url.pathname));
  await page.waitForLoadState('load');
  check(who + ': a map made by clicking reaches the correct service page', new URL(page.url()).hash === (who === 'creator' ? '#model' : '#decide'));
  return '【あなたの地図（ホームで選んだ内容）】\n目的: ' + map.goal + '\n今いる場所: ' + map.place + '\n最初の一歩: ' + map.step;
}

async function contactFrom(page, name, type, expectedBody, alreadyThere = false) {
  if (!alreadyThere) await open(page, name);
  await click(page.locator('[data-consult-page]').last());
  await page.waitForURL(url => /\/contact(?:\.html)?$/.test(url.pathname));
  await page.locator('#cType').waitFor();
  const actual = await page.evaluate(() => ({
    type: document.getElementById('cType').value, body: document.getElementById('cMsg').value.trim(),
    name: document.getElementById('cName').value, email: document.getElementById('cEmail').value,
    consumed: sessionStorage.getItem('reyz.map') === null, query: location.search,
  }));
  check(name + ': consultation topic follows the page', actual.type === type, actual.type);
  check(name + ': only the matching real map is carried', actual.body === expectedBody, actual.body);
  check(name + ': names are not invented or put in the URL', !actual.name && !actual.email && !actual.query);
  check(name + ': handoff is consumed once and remains an editable draft', actual.consumed && await page.locator('#stepForm').isVisible() && !await page.locator('#stepDone').isVisible());
  report.contacts.push({ page: name, type: actual.type, hasMap: !!actual.body });
}

async function contactJourneys(page) {
  const creator = await createMap(page, 'creator');
  // A demonstrative "take" must never be carried into the real inquiry.
  await click(page.locator('#demoC .tab[data-t="gate"]'));
  await click(page.locator('#demoC .take').first());
  await contactFrom(page, 'creator', '活動・収益化の相談', creator, true);
  await contactFrom(page, 'creative', '目的の整理と進め方の相談', '');
  const company = await createMap(page, 'company');
  await contactFrom(page, 'creative', '目的の整理と進め方の相談', company, true);
  await contactFrom(page, 'creator', '活動・収益化の相談', '');
  await contactFrom(page, 'ai', 'AIを仕事に入れる（REYZ PLATFORM）', '');
  await contactFrom(page, 'consensus', '公開前の確認と記録（REYZ CONSENSUS）', '');
}

async function motionAndFailure(browser) {
  const context = await contextFor(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await open(page, 'creative'); await click(page.locator('.hero-action[href="#show"]'));
  await page.waitForFunction(() => document.querySelector('[data-cinematic]').dataset.material === 'ribbon');
  const scrub = page.locator('.cinematic-scrub');
  check('reduce: begins at a complete still', await scrub.inputValue() === '100' && await page.locator('.cinematic-toggle').textContent() === '全体を見る');
  const before = await canvasState(page.locator('.cinematic-canvas')); await page.waitForTimeout(250);
  check('reduce: no autonomous canvas motion', (await canvasState(page.locator('.cinematic-canvas'))).hash === before.hash);
  check('reduce: all three phrases remain readable', await page.locator('.cinematic .words b').evaluateAll(elements => elements.length === 3 && elements.every(el => Number(getComputedStyle(el).opacity) >= 0.99)));
  await scrub.focus(); await scrub.press('Home');
  check('reduce: explicit keyboard seeking still works', await scrub.inputValue() === '0');
  await click(page.locator('.cinematic-toggle'));
  check('reduce: full view restores the final composition', await scrub.inputValue() === '100');
  await page.locator('.showcase').screenshot({ path: path.join(OUT, 'reduced-motion.png') });
  check('reduce: no JavaScript errors', errors.length === 0, errors);
  await context.close();

  const fallback = await contextFor(browser, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await fallback.route('**/brand/infinity-ribbon.webp', route => route.fulfill({ status: 200, contentType: 'image/webp', body: 'invalid-image-for-decoding-test' }));
  const p = await fallback.newPage(), failures = []; p.on('pageerror', error => failures.push(String(error)));
  await open(p, 'creative'); await click(p.locator('.hero-action[href="#show"]'));
  const signatures = [];
  for (const id of ['awareness', 'trust', 'action']) {
    await click(p.locator('.type-choice[data-scene="' + id + '"]'));
    const pixels = await canvasState(p.locator('.cinematic-canvas')); signatures.push(pixels.hash);
    check('decode failure: ' + id + ' still renders', pixels.samples > 100 && pixels.range > 50);
  }
  check('decode failure: all compositions and controls remain usable', new Set(signatures).size === 3 && await p.locator('.cinematic-toggle').isVisible());
  check('decode failure: no JavaScript errors', failures.length === 0, failures);
  await fallback.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  try {
    if (!base) {
      server = http.createServer(serve); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      base = 'http://127.0.0.1:' + server.address().port;
    }
    base = base.replace(/\/$/, '');
    const chrome = await chromium.launch(); launched.push(chrome);
    const safari = await webkit.launch(); launched.push(safari);
    await visualSections(chrome);
    for (const [label, browser, options] of [
      ['chromium-1440', chrome, { viewport: { width: 1440, height: 900 } }],
      ['chromium-390', chrome, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
      ['webkit-390', safari, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ]) {
      const context = await contextFor(browser, options), page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await creatorChoices(page, label); await cinematicChoices(page, label); await panelDestinations(page, label);
      if (label === 'chromium-1440') await contactJourneys(page);
      check(label + ': no JavaScript errors', errors.length === 0, errors);
      report.browsers.push(label); await context.close();
    }
    await motionAndFailure(chrome);
    check('no inquiry or other mutation was attempted', report.mutationRequests.length === 0, report.mutationRequests);
  } catch (error) {
    report.fails.push('acceptance did not finish: ' + String(error.stack || error));
  } finally {
    for (const browser of launched) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (report.fails.length) process.exitCode = 1;
  }
})();
