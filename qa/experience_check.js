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
  // 2026-11-21 CEO: 6 つの収益の横にあった線の図（装飾）を削除。6 項目は文字の一覧として残す
  await open(page, 'creator');
  check(label + ': six incomes remain as plain text', await page.locator('#income .incomes > li').count() === 6);
  check(label + ': no decorative canvas on creator', await page.locator('#income canvas, .income-stage, .income-choice').count() === 0);
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
}

async function publishingEntry(page, label) {
  await open(page, 'index');
  await click(page.locator('#origin a.company'));
  await page.waitForURL(url => /\/creative(?:\.html)?$/.test(url.pathname), { waitUntil: 'load' });
  // Take the actual first screen, before scrolling either the copy or its link into view.
  await page.waitForTimeout(1600);
  const pitch = await page.locator('#top p, #top .hero-action[href="#guard"]')
    .filter({ hasText: /ブランド|代理店|承認|差し替え/ }).evaluateAll(nodes => {
      const headerBottom = document.querySelector('#siteHeader').getBoundingClientRect().bottom;
      return nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return {
          text: node.innerText, link: node.matches('a'),
          fits: rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1
            && rect.top >= headerBottom - 1 && (innerHeight < 800 || rect.bottom <= innerHeight + 1),
        };
      });
    });
  const copy = pitch.filter(item => !item.link && item.fits).map(item => item.text).join('');
  check(label + ': first enterprise screen identifies the audience and the approval task',
    ['案件', 'ブランド', '代理店', '承認'].every(word => copy.includes(word)), pitch);
  check(label + ': first enterprise screen offers the material-change example',
    pitch.some(item => item.link && item.fits && /差し替え/.test(item.text)), pitch);
  const file = label + '-creative-publishing-entry.png';
  await page.screenshot({ path: path.join(OUT, file) });
  report.screenshots.push(file);
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
  // 2026-11-21 CEO: 意味を持たない粒子・映像・動きは置かない。どのページにも装飾の動画と粒子の描画面が無いことを確かめる
  const context = await contextFor(browser, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), mp4Requests = [];
  page.on('request', request => { if (new URL(request.url()).pathname.toLowerCase().endsWith('.mp4')) mp4Requests.push(request.url()); });
  for (const name of ['index', 'creator', 'creative', 'ai', 'consensus', 'contact', 'livers']) {
    await open(page, name);
    const found = await page.evaluate(() => ({ video: document.querySelectorAll('video').length, field: document.querySelectorAll('#field, [data-word], [data-brand-film], [data-editorial]').length }));
    check('no decorative film or particle field: ' + name, found.video === 0 && found.field === 0, found);
  }
  check('no MP4 is requested anywhere', mp4Requests.length === 0, mp4Requests);
  await open(page, 'index');
  check('home: business navigation works', await page.locator('#infinity .hero-route').first().isVisible());
  await click(page.locator('#infinity .hero-route').first());
  check('home: visitor reaches creator offer', /\/creator(?:\.html)?$/.test(new URL(page.url()).pathname));
  await context.close();
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
      await creatorChoices(page, label);
      await publishingEntry(page, label); await panelDestinations(page, label);
      await creativeContent(page, label);
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
