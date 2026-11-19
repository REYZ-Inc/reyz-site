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
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2' };
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

async function creativeContent(page, label) {
  await open(page, 'creative');
  const sections = await page.locator('main > section[id]').evaluateAll(nodes => nodes.map(node => node.id));
  check(label + ': offers precede workflow and pricing', sections.indexOf('services') < sections.indexOf('guard') && sections.indexOf('guard') < sections.indexOf('gain'), sections);
  check(label + ': duplicate pitch sections removed', !sections.includes('pain') && !sections.includes('compare'), sections);
  await click(page.locator('.hero-action[href="#services"]'));
  check(label + ': hero reaches actual offers', new URL(page.url()).hash === '#services' && await page.locator('#services .group').count() === 4);
  const offers = page.locator('#services details');
  check(label + ': all eleven concrete services remain available', await offers.count() === 11);
  await click(offers.first().locator('summary'));
  check(label + ': offer details open on request', await offers.first().getAttribute('open') !== null && /法律の鑑定ではありません/.test(await offers.first().innerText()));
  await controlsFit(page, '#services details > summary', label + ' services');
  const sampleLink = page.locator('#services a[href="#show"]');
  const sampleOffer = page.locator('#services details').filter({ has: page.locator('a[href="#show"]') });
  if (await sampleOffer.getAttribute('open') === null) await click(sampleOffer.locator('summary'));
  await click(sampleLink);
  await page.waitForFunction(() => {
    const heading = document.querySelector('#show h2').getBoundingClientRect();
    const header = document.querySelector('#siteHeader').getBoundingClientRect();
    return location.hash === '#show' && heading.top >= header.bottom && heading.bottom < innerHeight * .45;
  });
  const overviewFile = label + '-production-film.png';
  await page.screenshot({ path: path.join(OUT, overviewFile) });
  report.screenshots.push(overviewFile);
  const film = page.locator('#show [data-editorial]');
  check(label + ': production shown once without duplicated device mockup', await film.locator('video').count() === 1 && await page.locator('#show .editorial-device, #show [data-cinematic]').count() === 0);
  const credit = await film.locator('figcaption').innerText();
  const productionVideo = film.locator('video');
  check(label + ': original CG study and matching poster are credited', credit.includes('構図と光のイメージ映像（CG）') && credit.includes('REYZ / Motion study')
    && await productionVideo.getAttribute('data-src') === 'assets/editorial/creative-study-v1.mp4'
    && await productionVideo.getAttribute('poster') === 'assets/editorial/creative-study-v1.webp');
  const notes = page.locator('#show .study-notes');
  await notes.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const captions = await notes.locator(':scope > div').evaluateAll(rows => rows.map(row => {
    const title = row.querySelector('dt'), body = row.querySelector('dd');
    const rowBounds = row.getBoundingClientRect();
    const headerBottom = document.querySelector('#siteHeader').getBoundingClientRect().bottom;
    const fits = [title, body].every(part => {
      if (!part?.textContent.trim()) return false;
      const range = document.createRange();
      range.selectNodeContents(part);
      const lines = Array.from(range.getClientRects());
      return lines.length > 0 && lines.every(line => line.width > 0 && line.height > 0
        && line.left >= Math.max(0, rowBounds.left) - 1 && line.right <= Math.min(innerWidth, rowBounds.right) + 1
        && line.top >= headerBottom - 1 && line.bottom <= innerHeight + 1);
    });
    return { title: title?.textContent.trim(), fits };
  }));
  check(label + ': composition, light and motion notes are readable without clipping',
    captions.map(item => item.title).join('/') === '構図/光/動き' && captions.every(item => item.fits), captions);
  const notesFile = label + '-production-notes.png';
  await page.screenshot({ path: path.join(OUT, notesFile) });
  report.screenshots.push(notesFile);
}

async function panelDestinations(page, label) {
  const detail = page.locator('details.workflow-detail');
  check(label + ': detailed expression review initially optional', await detail.count() === 1 && await detail.getAttribute('open') === null);
  await click(page.locator('.hero-action[href="#guard"]'));
  check(label + ': workflow action reaches the complete case', await page.locator('[data-cycle]').isVisible() && new URL(page.url()).hash === '#guard');
  await click(detail.locator(':scope > summary'));
  check(label + ': detailed review opens with an actual map', await page.locator('#deP1').isVisible());
  await click(page.locator('#demoE [data-next="check"]').first());
  check(label + ': explicit check action selects check', await page.locator('#deP2').isVisible() && await page.locator('#deT2').getAttribute('aria-selected') === 'true');
  await click(detail.locator(':scope > summary'));
  check(label + ': detailed review can be folded again', await detail.getAttribute('open') === null && !await page.locator('#deP2').isVisible());
  await page.goto(base + '/creative#decide', { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('details.workflow-detail')?.open === true);
  check(label + ': a direct link opens its folded destination', await page.locator('#demoE').isVisible());
  // The opening handler schedules the anchor scroll for the next frame. Observe
  // that result, without scrolling the destination into place from the test.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const destination = await detail.locator(':scope > summary').evaluate(summary => {
    const r = summary.getBoundingClientRect();
    const header = document.querySelector('#siteHeader')?.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      headerBottom: Math.max(0, header?.bottom || 0), viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  check(label + ': direct-link summary is in the viewport below the fixed header',
    destination.top >= destination.headerBottom - 1 && destination.bottom <= destination.viewportHeight + 1
      && destination.left >= -1 && destination.right <= destination.viewportWidth + 1, destination);
  check(label + ': a direct link does not approve the cycle', /未承認/.test(await page.locator('#cycleApproval').innerText()));
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
  const mp4Requests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.toLowerCase().endsWith('.mp4')) {
      mp4Requests.push({ method: request.method(), url: request.url() });
    }
  });
  await open(page, 'index');
  const film = page.locator('[data-brand-film]'), video = film.locator('video'), toggle = film.locator('button');
  check('brand/reduce: one original brand film replaces the former infinity field', await film.count() === 1 && await page.locator('#infinity [data-word]').count() === 0);
  check('brand/reduce: the new film and its poster are paired', await video.getAttribute('data-src') === 'assets/brand/brand-contour-v1.mp4'
    && await video.getAttribute('poster') === 'assets/brand/brand-contour-v1.webp');
  const before = await video.evaluate(v => ({ paused: v.paused, time: v.currentTime, source: v.getAttribute('src'), poster: v.poster }));
  await page.waitForTimeout(250);
  const after = await video.evaluate(v => ({ paused: v.paused, time: v.currentTime, source: v.getAttribute('src') }));
  check('brand/reduce: no automatic media download or playback', before.paused && after.paused && before.time === after.time && !after.source, { before, after });
  check('brand/reduce: zero MP4 requests before explicit play', mp4Requests.length === 0, mp4Requests.slice());
  const expectedRoutes = [
    { path: 'creator', text: 'クリエイターの創造性を、続く収入に。' },
    { path: 'creative', text: '企業の発信を、設計から確認まで。' },
    { path: 'ai', text: 'AIを、安心して仕事に使える形に。' },
  ];
  const links = page.locator('#infinity .hero-route'), routeStates = [];
  for (let i = 0; i < await links.count(); i++) {
    const link = links.nth(i);
    routeStates.push({ visible: await link.isVisible(), text: (await link.innerText()).replace(/\s+/g, ''),
      path: new URL(await link.getAttribute('href'), page.url()).pathname.split('/').pop() });
  }
  check('brand/reduce: brand and all three business routes remain readable',
    await page.locator('#infinity h1').isVisible() && routeStates.length === 3
      && expectedRoutes.every((expected, i) => routeStates[i]?.visible
        && routeStates[i].text === expected.text && routeStates[i].path === expected.path), routeStates);
  await click(toggle);
  await page.waitForFunction(() => { const v = document.querySelector('[data-brand-video]'); return !v.paused && v.readyState >= 2 && v.currentTime > 0; });
  check('brand/reduce: explicit play decodes the brand film', await video.evaluate(v => v.videoWidth >= 960 && v.videoHeight > 0 && v.muted && v.playsInline));
  await click(toggle); const stopped = await video.evaluate(v => ({ paused: v.paused, time: v.currentTime }));
  await page.waitForTimeout(250);
  check('brand/reduce: explicit pause holds native video time', stopped.paused && await video.evaluate((v, time) => v.paused && Math.abs(v.currentTime - time) < 0.04, stopped.time));
  await controlsFit(page, '[data-brand-toggle]', 'brand control');
  await page.screenshot({ path: path.join(OUT, 'brand-reduced-motion.png') });
  check('brand/reduce: no JavaScript errors', errors.length === 0, errors);
  await context.close();

  const fallback = await contextFor(browser, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await fallback.route('**/brand/brand-contour-v1.mp4', route => route.fulfill({ status: 200, contentType: 'video/mp4', body: 'invalid-video-for-decoding-test' }));
  const p = await fallback.newPage(), failures = []; p.on('pageerror', error => failures.push(String(error)));
  await open(p, 'index'); await click(p.locator('[data-brand-toggle]'));
  await p.waitForFunction(() => document.querySelector('[data-brand-video]').error !== null);
  check('brand/decode failure: failed playback exposes an honest still state', await p.locator('[data-brand-toggle]').isDisabled() && /静止画/.test(await p.locator('[data-brand-toggle]').innerText()));
  check('brand/decode failure: poster actually decodes', await p.locator('[data-brand-video]').evaluate(async v => {
    const image = new Image(); image.src = v.poster; try { await image.decode(); return image.naturalWidth >= 960; } catch { return false; }
  }));
  check('brand/decode failure: business navigation still works', await p.locator('#infinity .hero-route').first().isVisible());
  await click(p.locator('#infinity .hero-route').first());
  check('brand/decode failure: visitor reaches creator offer', /\/creator(?:\.html)?$/.test(new URL(p.url()).pathname));
  check('brand/decode failure: no JavaScript errors', failures.length === 0, failures);
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
      await creatorChoices(page, label); await creativeContent(page, label); await panelDestinations(page, label);
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
