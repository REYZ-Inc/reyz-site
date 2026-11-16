// Browser acceptance for the manual's editing/reading experience.
// PDF bytes, all six PDF palettes and download recovery remain in manual_check.js.
// Usage: node qa/manual_experience_check.js site [output-directory]
// Optional BASE targets an already-running preview; otherwise serve ROOT locally.
// OUT_DIR, then QA_OUT/manual-experience, supply the default artifact directory.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(process.argv[2] || 'site');
const OUT = path.resolve(process.argv[3] || process.env.OUT_DIR
  || path.join(process.env.QA_OUT || 'qa/out', 'manual-experience'));
const THEME_IDS = ['pink', 'blue', 'purple', 'green', 'coral', 'gray'];
const ACCENTS = { pink: 'rgb(247, 21, 172)', blue: 'rgb(65, 105, 225)', purple: 'rgb(139, 92, 246)', green: 'rgb(22, 139, 114)' };
const SAMPLE_REQUEST = /\/assets\/manual\/preview-(?:index\.json|\d+\.svg)(?:[?#]|$)/;
const PDF_REQUEST = /\/assets\/manual\/(?:template\.pdf|layout\.json|vendor\/)/;
const report = { checks: 0, fails: [], browsers: [], viewports: [], recovery: {}, screenshots: [] };
const browsers = [];
let server;
let base = (process.env.BASE || '').replace(/\/$/, '');

function check(label, passed, details) {
  report.checks++;
  if (!passed) report.fails.push(label + (details === undefined ? '' : ': ' + JSON.stringify(details)));
  return passed;
}

function serve(request, response) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); response.end(); return; }
  let file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(ROOT + path.sep)) { response.writeHead(403); response.end(); return; }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
  };
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
}

async function screenshot(page, filename, fullPage = false) {
  await page.screenshot({ path: path.join(OUT, filename), fullPage, animations: 'disabled' });
  report.screenshots.push(filename);
}

async function newSession(browser, width, reducedMotion = 'no-preference') {
  const context = await browser.newContext({
    viewport: { width, height: width === 1440 ? 900 : 844 },
    isMobile: width !== 1440, hasTouch: width !== 1440, reducedMotion,
  });
  // Display-font service availability must not determine whether the reader works.
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  return { context, page, errors, requests };
}

async function openManual(page) {
  await page.goto(base + '/manual', { waitUntil: 'load' });
  await page.locator('#manual-cover-name-bottom').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('manualOptions').disabled);
  await page.evaluate(() => document.fonts.ready);
}

async function waitForSample(page, position) {
  await page.waitForFunction(expected => {
    const stage = document.getElementById('manualReaderPage');
    const count = document.getElementById('manualReaderCount').textContent.trim().split('/').map(Number);
    const names = Array.from(stage.querySelectorAll('[data-manual-name]'));
    return stage.getAttribute('aria-busy') === 'false' && !!stage.querySelector('svg')
      && count[0] === expected && names.length > 0 && names.every(node => node.textContent === 'REYZ');
  }, position);
}

async function sampleSnapshot(page) {
  return page.evaluate(() => {
    const reader = document.getElementById('manualReader');
    const stage = document.getElementById('manualReaderPage');
    const canvas = stage.closest('.manual-reader-canvas');
    const rect = reader.getBoundingClientRect();
    const ids = Array.from(document.querySelectorAll('[id]')).map(node => node.id);
    return {
      title: document.getElementById('manualReaderTitle').textContent.trim(),
      count: document.getElementById('manualReaderCount').textContent.trim(),
      status: document.getElementById('manualReaderStatus').textContent.trim(),
      names: Array.from(stage.querySelectorAll('[data-manual-name]')).map(node => ({ text: node.textContent, fill: getComputedStyle(node).fill })),
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
      coverSvgCount: document.querySelectorAll('#manualPreview svg').length,
      withinViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      pageFitsHorizontally: canvas.scrollWidth <= canvas.clientWidth + 1,
      pageHasContent: stage.querySelectorAll('path, image, use').length > 10,
    };
  });
}

async function checkClosed(page, label) {
  await page.waitForFunction(() => !document.getElementById('manualReader').open
    && document.activeElement === document.getElementById('manualRead'));
  check(label + ': closing returns focus to the reader button', await page.locator('#manualRead').evaluate(node => document.activeElement === node));
  check(label + ': closing restores page scrolling', await page.evaluate(() => !document.documentElement.classList.contains('manual-reader-open')));
  check(label + ': editing remains available', await page.locator('#manualName').isEnabled() && await page.locator('#manualGenerate').isEnabled());
}

async function viewportCase(browser, engine, width, theme, reducedMotion) {
  const label = `${engine}-${width}`;
  const session = await newSession(browser, width, reducedMotion);
  const { context, page, errors, requests } = session;
  const result = { label, width, theme, reducedMotion };
  try {
    await openManual(page);
    check(label + ': no sample assets before opening the reader', !requests.some(request => SAMPLE_REQUEST.test(request.url)));
    check(label + ': initial screen does not load PDF assets or the heavy name font',
      !requests.some(request => PDF_REQUEST.test(request.url) || /\/manual\/fonts\/Noto/.test(request.url)));
    check(label + ': all six choices are available',
      JSON.stringify(await page.locator('input[name="theme"]').evaluateAll(nodes => nodes.map(node => node.value))) === JSON.stringify(THEME_IDS));
    check(label + ': empty input and REYZ example', await page.locator('#manualName').inputValue() === ''
      && await page.locator('#manualName').getAttribute('placeholder') === '例：REYZ');

    result.layout = await page.evaluate(() => {
      const controls = ['manualName', 'manualPalettes', 'manualGenerate', 'manualPreview', 'manualRead'];
      const bounds = controls.map(id => {
        const node = document.getElementById(id), rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { id, left: rect.left, right: rect.right, top: rect.top + scrollY, bottom: rect.bottom + scrollY, width: rect.width, height: rect.height,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 };
      });
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, bounds,
        nameFontSize: parseFloat(getComputedStyle(document.getElementById('manualName')).fontSize) };
    });
    const layout = result.layout;
    check(label + ': form and CTA stay inside the viewport width', layout.scrollWidth <= layout.width + 1
      && layout.bounds.every(rect => rect.visible && rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= layout.width + 1), layout);
    const cta = layout.bounds.find(rect => rect.id === 'manualGenerate');
    // The old mobile form placed this action below 1,400px. Allow one viewport
    // plus a short 120px scroll, without asserting exact grid rows or CSS values.
    check(label + ': download action is discoverable with at most a short scroll', cta.bottom <= layout.height + 120,
      { ctaBottom: cta.bottom, viewportHeight: layout.height, allowance: 120 });
    check(label + ': primary controls are comfortable to tap', layout.bounds.filter(rect => ['manualName', 'manualGenerate', 'manualRead'].includes(rect.id))
      .every(rect => rect.width >= 44 && rect.height >= 44) && layout.nameFontSize >= 16);

    await page.locator('#manualName').fill('REYZ');
    await page.locator(`input[name="theme"][value="${theme}"]`).check();
    await page.waitForFunction(() => document.getElementById('manual-cover-name-bottom').textContent === 'REYZ');
    await screenshot(page, `manual-${label}.png`, true);
    await page.locator('#manualGenerate').click({ trial: true });
    check(label + ': download action is enabled and reachable', await page.locator('#manualGenerate').isEnabled());

    await page.locator('#manualRead').click();
    await waitForSample(page, 1);
    check(label + ': native reader is visible', await page.locator('#manualReader').isVisible());
    check(label + ': first sample has a next page and no previous page',
      await page.locator('#manualReaderPrev').isDisabled() && await page.locator('#manualReaderNext').isEnabled());
    const first = await sampleSnapshot(page);
    check(label + ': first sample is the cover', first.title === '表紙' && first.status.includes('1ページ目'), first);
    check(label + ': cover sample reflects the selected name and color', first.names.length > 0
      && first.names.every(name => name.text === 'REYZ' && name.fill === ACCENTS[theme]), first.names);

    await page.locator('#manualReaderClose').focus();
    await page.keyboard.press('Shift+Tab');
    check(label + ': keyboard focus stays inside the modal', await page.locator('#manualReader').evaluate(node => node.contains(document.activeElement)));
    await page.locator('#manualReaderNext').click();
    await waitForSample(page, 2);
    const second = await sampleSnapshot(page);
    check(label + ': next opens a different readable page', second.title !== first.title && second.pageHasContent && second.status.includes('3ページ目'), second);
    check(label + ': interior page keeps name and color', second.names.length > 0
      && second.names.every(name => name.text === 'REYZ' && name.fill === ACCENTS[theme]), second.names);
    check(label + ': modal and page fit horizontally', second.withinViewport && second.pageFitsHorizontally, second);
    check(label + ': samples do not duplicate cover SVGs or SVG definition IDs', second.coverSvgCount === 1 && second.duplicateIds.length === 0, second.duplicateIds);
    await screenshot(page, `reader-${label}.png`);

    await page.locator('#manualReaderPrev').click();
    await waitForSample(page, 1);
    check(label + ': previous returns to the same cover', (await sampleSnapshot(page)).title === first.title);
    if (engine === 'chromium' && width === 390) {
      result.remainingSamples = [];
      for (const position of [2, 3, 4]) {
        await page.keyboard.press('ArrowRight');
        await waitForSample(page, position);
        if (position > 2) {
          const sample = await sampleSnapshot(page);
          check(label + `: sample ${position} is readable with the chosen settings`, sample.pageHasContent
            && sample.names.every(name => name.text === 'REYZ' && name.fill === ACCENTS[theme])
            && sample.pageFitsHorizontally && sample.duplicateIds.length === 0, sample);
          result.remainingSamples.push(sample);
          await screenshot(page, `reader-${label}-sample-${position}.png`);
        }
      }
      check(label + ': last sample has a previous page and no next page',
        await page.locator('#manualReaderPrev').isEnabled() && await page.locator('#manualReaderNext').isDisabled());
      await page.keyboard.press('Escape');
    } else {
      await page.locator('#manualReaderClose').click();
    }
    await checkClosed(page, label);
    check(label + ': closing preserves the chosen settings', await page.locator('#manualName').inputValue() === 'REYZ'
      && await page.locator('input[name="theme"]:checked').inputValue() === theme);
    check(label + ': reading does not load the PDF generator', !requests.some(request => PDF_REQUEST.test(request.url)));
    result.first = first;
    result.interior = second;
    result.sampleRequests = requests.filter(request => SAMPLE_REQUEST.test(request.url)).map(request => new URL(request.url).pathname);
  } catch (error) {
    check(label + ': user journey completed', false, String(error));
    try { await screenshot(page, `failure-${label}.png`, true); } catch { /* Report the original failure. */ }
  } finally {
    check(label + ': no unhandled page errors', errors.length === 0, errors);
    report.viewports.push(result);
    await context.close();
  }
}

async function recoveryCase(browser) {
  const { context, page, errors, requests } = await newSession(browser, 390, 'reduce');
  let attempts = 0;
  try {
    await context.route('**/assets/manual/preview-*.svg', async route => {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, contentType: 'text/plain', body: 'QA temporary sample failure' });
      return route.continue();
    });
    await openManual(page);
    await page.locator('#manualName').fill('REYZ');
    await page.locator('input[name="theme"][value="green"]').check();
    await page.locator('#manualRead').click();
    const retry = page.locator('#manualReader').getByRole('button', { name: 'もう一度表示する', exact: true });
    await retry.waitFor({ state: 'visible' });
    check('sample failure: retry is actionable and failure is announced', await retry.isEnabled()
      && (await page.locator('#manualReaderStatus').textContent()).includes('表示できませんでした'));
    check('sample failure: entered name and selected color are retained', await page.locator('#manualName').inputValue() === 'REYZ'
      && await page.locator('input[name="theme"]:checked').inputValue() === 'green');
    await screenshot(page, 'reader-retry-chromium-390.png');
    await retry.click();
    await waitForSample(page, 1);
    const recovered = await sampleSnapshot(page);
    check('sample retry: real page recovers without re-entering settings', attempts === 2 && recovered.names.length > 0
      && recovered.names.every(name => name.text === 'REYZ' && name.fill === ACCENTS.green), { attempts, names: recovered.names });
    await screenshot(page, 'reader-recovered-chromium-390.png');
    await page.locator('#manualReaderClose').click();
    await checkClosed(page, 'sample retry');
    check('sample retry: no PDF or API submission was needed', !requests.some(request => PDF_REQUEST.test(request.url) || request.method !== 'GET'));
    report.recovery = { attempts, recovered };
  } catch (error) {
    check('sample recovery journey completed', false, String(error));
    try { await screenshot(page, 'failure-reader-recovery.png', true); } catch { /* Report the original failure. */ }
  } finally {
    check('sample retry: no unhandled page errors', errors.length === 0, errors);
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!base) {
    server = http.createServer(serve);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  const options = process.env.QA_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.QA_CHROMIUM_EXECUTABLE_PATH } : {};
  const chrome = await chromium.launch(options);
  browsers.push(chrome);
  report.browsers.push({ engine: 'chromium', version: chrome.version() });
  await viewportCase(chrome, 'chromium', 320, 'pink', 'reduce');
  await viewportCase(chrome, 'chromium', 390, 'blue', 'no-preference');
  await viewportCase(chrome, 'chromium', 1440, 'purple', 'no-preference');
  await recoveryCase(chrome);
  const wk = await webkit.launch();
  browsers.push(wk);
  report.browsers.push({ engine: 'webkit', version: wk.version(), device: 'mobile viewport emulation, not a physical iPhone' });
  await viewportCase(wk, 'webkit', 390, 'green', 'reduce');
}

main().catch(error => { check('browser runner', false, String(error)); }).finally(async () => {
  for (const browser of browsers) { try { await browser.close(); } catch { /* Preserve the original result. */ } }
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (report.fails.length) process.exitCode = 1;
});
