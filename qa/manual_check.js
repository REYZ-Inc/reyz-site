// User-facing acceptance for the manual configurator. Generated files are parsed
// independently with PDF.js; screenshots/PDFs and measurements remain in QA_OUT.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(process.argv[2] || 'site');
const OUT = path.resolve(process.argv[3] || 'qa/out/manual');
const THEMES = [
  ['pink', '#f715ac'], ['blue', '#4169e1'], ['purple', '#8b5cf6'],
  ['green', '#168b72'], ['coral', '#d96156'], ['gray', '#737783'],
];
const report = { checks: 0, fails: [], browsers: [], downloads: [], requests: [], pdf: [] };
const browsers = [];
let server;
let pdfjs;
let baseline;
let base;

function check(label, ok, details) {
  report.checks++;
  if (!ok) report.fails.push(label + (details === undefined ? '' : ': ' + JSON.stringify(details)));
}
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function verifyAssetManifest() {
  const assets = path.join(ROOT, 'assets/manual');
  const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'asset-manifest.json'), 'utf8'));
  const expected = [
    'cover.svg', 'fonts/NotoSansJP-Bold.woff', 'fonts/OFL-notosansjp.txt',
    'fonts/OFL-poppins.txt', 'fonts/Poppins-Bold.woff', 'layout.json',
    'name-coverage.js', 'template.pdf', 'vendor/fontkit-1.1.1.umd.min.js',
    'vendor/fontkit-LICENSE.txt', 'vendor/pdf-lib-1.17.1.min.js', 'vendor/pdf-lib-LICENSE.txt',
  ];
  const entries = manifest.files;
  check('asset manifest covers the template, fonts, fixed libraries and licences',
    Array.isArray(entries) && entries.length === expected.length
      && JSON.stringify(entries.map(entry => entry.path).sort()) === JSON.stringify([...expected].sort()));
  if (report.fails.length) throw new Error('Manual asset manifest inventory is invalid');
  for (const entry of entries) {
    const bytes = fs.readFileSync(path.join(assets, entry.path));
    check('asset manifest byte count: ' + entry.path, Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && bytes.length === entry.bytes);
    check('asset manifest SHA-256: ' + entry.path, typeof entry.sha256 === 'string'
      && /^[a-f0-9]{64}$/.test(entry.sha256) && sha(bytes) === entry.sha256);
  }
  if (report.fails.length) throw new Error('Manual asset manifest integrity check failed');
}
function compact(text) { return text.replace(/\s+/gu, ''); }
function hexColor(color) {
  if (typeof color === 'string') return color.toLowerCase();
  return '#' + Array.from(color).slice(0, 3).map(x => Math.round(x > 1 ? x : x * 255).toString(16).padStart(2, '0')).join('');
}
function rgbHex(css) {
  if (css.startsWith('#')) return css.toLowerCase();
  const nums = css.match(/[\d.]+/g);
  return nums ? '#' + nums.slice(0, 3).map(x => Number(x).toString(16).padStart(2, '0')).join('') : css;
}
function serve(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end(); }
  let file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
}

async function readPDF(file, name, accent, reference) {
  const bytes = fs.readFileSync(file);
  check(path.basename(file) + ': PDF signature', bytes.subarray(0, 5).toString() === '%PDF-');
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false,
    isOffscreenCanvasSupported: false, useSystemFonts: false,
    standardFontDataUrl: path.dirname(require.resolve('pdfjs-dist/package.json')) + '/standard_fonts/',
  });
  const doc = await loading.promise;
  const result = { pages: [], names: 0, nameColors: [], colors: [], links: [], size: bytes.length, sha256: sha(bytes) };
  try {
    check(path.basename(file) + ': 42 pages', doc.numPages === 42, doc.numPages);
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const textItems = content.items.filter(x => typeof x.str === 'string' && x.str.trim());
      const text = textItems.map(x => x.str).join(' ');
      check(path.basename(file) + `: p${n} dimensions`, page.view[2] - page.view[0] === 540 && page.view[3] - page.view[1] === 960, page.view);
      check(path.basename(file) + `: p${n} no old name`, !text.includes('REYZ STUDIO'));
      check(path.basename(file) + `: p${n} no missing characters`, !/[\u0000\uFFFD]/u.test(text));
      if (name) {
        for (const item of textItems.filter(x => compact(x.str) === compact(name))) {
          check(path.basename(file) + `: p${n} name fits page`, item.transform[4] >= 0 && item.transform[5] >= 0 && item.transform[4] + item.width <= 540.1 && item.transform[5] + item.height <= 960.1, { x: item.transform[4], y: item.transform[5], width: item.width, height: item.height });
        }
      }
      const body = textItems.filter(x => !name || compact(x.str) !== compact(name)).map(x => ({ text: x.str, transform: x.transform, width: x.width, height: x.height }));
      const annotations = await page.getAnnotations();
      const links = [];
      for (const annotation of annotations.filter(x => x.subtype === 'Link')) {
        let dest = annotation.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (Array.isArray(dest)) {
          const target = typeof dest[0] === 'number' ? dest[0] + 1 : await doc.getPageIndex(dest[0]) + 1;
          links.push({ rect: annotation.rect, target });
          result.links.push({ page: n, target });
        } else check(path.basename(file) + `: p${n} internal destination`, false, annotation.dest);
      }
      const ops = await page.getOperatorList();
      const images = [];
      let fill = '#000000';
      const state = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], args = ops.argsArray[i];
        if (fn === pdfjs.OPS.save) state.push(fill);
        else if (fn === pdfjs.OPS.restore) fill = state.pop() || '#000000';
        else if (fn === pdfjs.OPS.setFillRGBColor) { fill = hexColor(args[0]); result.colors.push(fill); }
        else if (fn === pdfjs.OPS.setStrokeRGBColor) result.colors.push(hexColor(args[0]));
        else if (fn === pdfjs.OPS.showText) {
          const shown = args[0].map(x => typeof x === 'object' ? x.unicode || '' : '').join('');
          if (name && compact(shown) === compact(name)) {
            result.names++;
            result.nameColors.push(fill);
            // ToUnicode can preserve the full name even when a malformed subset
            // omits drawable glyphs. Check the renderer's embedded-font mapping.
            // CID-font spaces can have isSpace=false; their Unicode whitespace
            // needs an advance, not a drawable outline.
            const nameGlyphs = args[0].filter(glyph => typeof glyph === 'object' && glyph !== null && /\S/u.test(glyph.unicode || ''));
            const missingGlyphs = nameGlyphs.filter(glyph => glyph.isInFont !== true).map(glyph => glyph.unicode);
            check(path.basename(file) + `: p${n} every name glyph exists in embedded font`, nameGlyphs.length > 0 && missingGlyphs.length === 0, missingGlyphs);
          }
        } else if (fn === pdfjs.OPS.paintImageXObject) {
          const objects = args[0].startsWith('g_') ? page.commonObjs : page.objs;
          const image = await new Promise(resolve => objects.get(args[0], resolve));
          if (!image || !image.data) throw new Error(`p${n}: decoded image data unavailable`);
          images.push({ width: image.width, height: image.height, kind: image.kind, sha256: sha(image.data) });
        } else if (fn === pdfjs.OPS.paintInlineImageXObject) {
          const image = args[0];
          images.push({ width: image.width, height: image.height, kind: image.kind, sha256: sha(image.data) });
        }
      }
      result.pages.push({ body, images, links });
      if (reference) {
        check(path.basename(file) + `: p${n} original text and position`, JSON.stringify(body) === JSON.stringify(reference.pages[n - 1].body));
        check(path.basename(file) + `: p${n} original images`, JSON.stringify(images) === JSON.stringify(reference.pages[n - 1].images));
        check(path.basename(file) + `: p${n} original links`, JSON.stringify(links) === JSON.stringify(reference.pages[n - 1].links));
      }
      page.cleanup();
    }
    if (name) {
      check(path.basename(file) + ': 47 names', result.names === 47, result.names);
      check(path.basename(file) + ': every name has selected color', result.nameColors.length === 47 && result.nameColors.every(x => x === accent), [...new Set(result.nameColors)]);
      check(path.basename(file) + ': selected accent in document', result.colors.includes(accent));
      if (accent !== '#f715ac') check(path.basename(file) + ': former accent replaced', !result.colors.includes('#f715ac'));
    }
    check(path.basename(file) + ': 45 working internal links', result.links.length === 45, result.links.length);
    check(path.basename(file) + ': contents destinations', JSON.stringify(result.links.filter(x => x.page === 2).map(x => x.target)) === '[3,7,13,18,36]');
    check(path.basename(file) + ': back-to-contents destinations', result.links.filter(x => x.page > 2).every(x => x.target === 2));
    const info = await doc.getMetadata();
    check(path.basename(file) + ': no PDF JavaScript', !(await doc.hasJSActions()));
    if (name) check(path.basename(file) + ': metadata has no former name', !JSON.stringify(info.info).includes('REYZ STUDIO'));
    if (name) report.pdf.push({ file: path.relative(OUT, file), pages: doc.numPages, names: result.names, accent, bytes: bytes.length, links: result.links.length, sha256: result.sha256 });
    return result;
  } finally { await loading.destroy(); }
}

async function newContext(browser, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...options });
  // External display-font availability is not part of the download service.
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  return context;
}

async function openManual(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', async dialog => { errors.push('unexpected dialog: ' + dialog.message()); await dialog.dismiss(); });
  page.on('request', req => report.requests.push({ url: req.url(), method: req.method(), body: req.postData() }));
  await page.goto(base + '/manual', { waitUntil: 'load' });
  await page.locator('input[name="theme"]').first().waitFor();
  await page.locator('#manual-cover-name-bottom').waitFor();
  await page.waitForFunction(() => document.getElementById('manualPreview').dataset.ready === 'true');
  return { page, errors };
}

async function generate(page, name, theme, label) {
  await page.locator('#manualName').fill(name);
  await page.locator(`input[name="theme"][value="${theme}"]`).check();
  const normalized = name.normalize('NFC').trim();
  await page.waitForFunction(expected => document.getElementById('manual-cover-name-bottom')?.textContent === expected, normalized);
  const preview = await page.locator('#manual-cover-name-bottom').evaluate(el => ({ text: el.textContent, fill: getComputedStyle(el).fill }));
  check(label + ': preview name', preview.text === normalized, preview);
  check(label + ': preview color', rgbHex(preview.fill) === THEMES.find(x => x[0] === theme)[1], preview);
  const started = Date.now();
  const waiting = page.waitForEvent('download', { timeout: 90000 });
  await page.locator('#manualGenerate').click();
  const download = await waiting;
  const file = path.join(OUT, label + '.pdf');
  await download.saveAs(file);
  check(label + ': download completed', (await download.failure()) === null);
  check(label + ': PDF filename', /\.pdf$/i.test(download.suggestedFilename()) && !/[\\/\u0000-\u001f]/u.test(download.suggestedFilename()), download.suggestedFilename());
  await page.waitForFunction(() => !document.getElementById('manualOptions').disabled);
  check(label + ': explicit save remains', await page.locator('#manualDownload').isVisible() && (await page.locator('#manualDownload').getAttribute('href') || '').startsWith('blob:'));
  check(label + ': explicit open remains', await page.locator('#manualOpen').isVisible() && (await page.locator('#manualOpen').getAttribute('href') || '').startsWith('blob:'));
  report.downloads.push({ label, milliseconds: Date.now() - started, bytes: fs.statSync(file).size, suggestedFilename: download.suggestedFilename() });
  return file;
}

async function invalidInput(page, value, label) {
  await page.locator('#manualName').fill(value);
  await page.locator('#manualGenerate').click();
  const status = await page.evaluate(() => ({ invalid: !document.getElementById('manualName').checkValidity(), message: document.getElementById('manualError').textContent.trim(), busy: document.getElementById('manualOptions').disabled, resultHidden: document.getElementById('manualResult').hidden }));
  check(label + ': explicit validation', status.invalid || !!status.message, status);
  check(label + ': no result or busy state', !status.busy && status.resultHidden, status);
}

async function nodePDFChecks() {
  // Explicit component-only mode for constrained local environments. The normal
  // CI path still requires both browser engines and real download events.
  report.mode = 'node-pdf-component';
  const assets = path.join(ROOT, 'assets/manual');
  globalThis.PDFLib = require(path.join(assets, 'vendor/pdf-lib-1.17.1.min.js'));
  globalThis.fontkit = require(path.join(assets, 'vendor/fontkit-1.1.1.umd.min.js'));
  const originalFetch = globalThis.fetch;
  let failNext = false;
  globalThis.fetch = async resource => {
    const url = resource instanceof URL ? resource : new URL(resource);
    if (url.protocol !== 'file:') throw new Error('component test permits only local static assets');
    const file = require('node:url').fileURLToPath(url);
    if (!file.startsWith(assets + path.sep)) throw new Error('asset outside manual directory');
    report.requests.push({ url: url.href, method: 'GET', body: null });
    if (failNext && file.endsWith('template.pdf')) { failNext = false; return new Response('temporary failure', { status: 503 }); }
    return new Response(fs.readFileSync(file), { status: 200 });
  };
  try {
    const { createManual } = await import(pathToFileURL(path.join(assets, 'manual-core.js')).href);
    const { validateName } = await import(pathToFileURL(path.join(ROOT, 'assets/manual-config.js')).href);
    const invalid = ['', '  ', 'あ'.repeat(25), '蝶🦋Studio', 'Studio\nQA', 'Studio\u202eQA'];
    for (const name of invalid) {
      check('component rejects invalid name ' + JSON.stringify(name), !validateName(name).valid);
      let rejected = false;
      const before = report.requests.length;
      try { await createManual({ name, themeId: 'pink' }); } catch { rejected = true; }
      check('invalid input rejected before asset request ' + JSON.stringify(name), rejected && report.requests.length === before);
    }
    check('component normalizes NFC and trims', validateName('  Cafe\u0301  ').normalized === 'Café');
    const cases = THEMES.map(([themeId, accent]) => ({ name: 'REYZ', themeId, accent, label: 'node-' + themeId }));
    cases.push(
      { name: '株式会社レイズ', themeId: 'pink', accent: '#f715ac', label: 'node-japanese' },
      { name: 'あ'.repeat(24), themeId: 'purple', accent: '#8b5cf6', label: 'node-max-name' },
      { name: '<svg onload=alert(1)>', themeId: 'blue', accent: '#4169e1', label: 'node-literal-markup' },
      { name: '  Cafe\u0301  ', themeId: 'green', accent: '#168b72', label: 'node-nfc' },
    );
    for (const example of cases) {
      const started = Date.now();
      const progress = [];
      const output = await createManual({ name: example.name, themeId: example.themeId, onProgress: value => progress.push(value.value) });
      const file = path.join(OUT, example.label + '.pdf');
      fs.writeFileSync(file, output.bytes);
      check(example.label + ': progress completes', progress.at(-1) === 100 && progress.every((n, i) => i === 0 || n >= progress[i - 1]), progress);
      check(example.label + ': filename safe', /\.pdf$/i.test(output.fileName) && !/[<>:"/\\|?*\u0000-\u001f]/u.test(output.fileName), output.fileName);
      report.downloads.push({ label: example.label, milliseconds: Date.now() - started, bytes: output.bytes.length, suggestedFilename: output.fileName });
      await readPDF(file, example.name.normalize('NFC').trim(), example.accent, baseline);
    }
    failNext = true;
    let failed;
    try { await createManual({ name: 'REYZ Retry', themeId: 'blue' }); } catch (error) { failed = error; }
    check('component asset failure is explicit', failed?.code === 'network' && !!failed?.message, failed && { code: failed.code, message: failed.message });
    const retried = await createManual({ name: 'REYZ Retry', themeId: 'blue' });
    check('component retries after failure', retried.pageCount === 42 && retried.bytes.length > 0);
    const controller = new AbortController();
    let aborted;
    try {
      await createManual({ name: 'REYZ Cancel', themeId: 'pink', signal: controller.signal, onProgress: update => { if (update.value >= 40) controller.abort(); } });
    } catch (error) { aborted = error; }
    check('component cancels between generation stages', aborted?.name === 'AbortError', aborted && { name: aborted.name, message: aborted.message });
    check('component name is not an asset URL', report.requests.every(req => !/REYZ|株式会社/.test(decodeURIComponent(req.url))));
    report.requestSummary = { count: report.requests.length, source: 'local static-file adapter, not browser network' };
    delete report.requests;
  } finally { globalThis.fetch = originalFetch; }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  verifyAssetManifest();
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  baseline = await readPDF(path.join(ROOT, 'assets/manual/template.pdf'), null, null, null);
  if (process.argv.includes('--pdf-only')) return nodePDFChecks();
  report.mode = 'browser-download';
  server = http.createServer(serve);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const chromeOptions = process.env.QA_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.QA_CHROMIUM_EXECUTABLE_PATH } : {};
  const chrome = await chromium.launch(chromeOptions); browsers.push(chrome);
  report.browsers.push({ engine: 'chromium', version: chrome.version(), executableOverride: process.env.QA_CHROMIUM_EXECUTABLE_PATH || null });
  const context = await newContext(chrome);
  const { page, errors } = await openManual(context);
  check('initial empty name', await page.locator('#manualName').inputValue() === '');
  check('name omitted from form URL encoding', await page.locator('#manualName').getAttribute('name') === null);
  check('initial placeholder preview', await page.locator('#manual-cover-name-bottom').textContent() === 'YOUR NAME');
  check('six theme choices', JSON.stringify(await page.locator('input[name="theme"]').evaluateAll(els => els.map(x => x.value))) === JSON.stringify(THEMES.map(x => x[0])));
  check('initial pink', await page.locator('input[name="theme"]:checked').inputValue() === 'pink');
  check('no initial PDF or heavy font download', !report.requests.some(x => /\/assets\/manual\/(?:template\.pdf|layout\.json|vendor\/|fonts\/Noto)/.test(x.url)));
  check('initial result hidden', await page.locator('#manualResult').isHidden());
  check('error and status live regions', await page.locator('#manualError').getAttribute('role') === 'alert' && await page.locator('#manualStatus').getAttribute('role') === 'status');

  await page.locator('input[name="theme"][value="pink"]').focus();
  await page.keyboard.press('ArrowRight');
  check('keyboard radio selection', await page.locator('input[name="theme"]:checked').inputValue() === 'blue');
  await invalidInput(page, '', 'empty name');
  await invalidInput(page, '   ', 'whitespace name');
  await invalidInput(page, 'あ'.repeat(25), 'overlong name');
  await invalidInput(page, '蝶🦋Studio', 'unsupported glyph');
  const config = await page.evaluate(async () => {
    const m = await import('/assets/manual-config.js');
    return { nfc: m.validateName('  Cafe\u0301  '), controls: m.validateName('Studio\nQA'), max: m.validateName('あ'.repeat(24)) };
  });
  check('NFC normalization and trim', config.nfc.valid && config.nfc.normalized === 'Café', config.nfc);
  check('control characters rejected', !config.controls.valid);
  check('24 codepoints accepted', config.max.valid);
  const markup = '<svg onload=alert(1)>';
  await page.locator('#manualName').fill(markup);
  await page.waitForFunction(expected => document.getElementById('manual-cover-name-bottom')?.textContent === expected, markup);
  check('name is text, not HTML', await page.locator('#manual-cover-name-bottom').textContent() === markup && (await page.locator('#manualPreview svg').count()) === 1);

  await page.goto(base + '/creator', { waitUntil: 'load' });
  check('Creator service link', (await page.locator('main a[href="manual"]').count()) > 0);
  check('footer link', (await page.locator('footer a[href="manual"]').count()) > 0);
  await page.locator('main a[href="manual"]').first().click();
  await page.locator('#manual-cover-name-bottom').waitFor();
  check('Creator link reaches manual', new URL(page.url()).pathname === '/manual');

  for (const [theme, accent] of THEMES) {
    const file = await generate(page, 'REYZ', theme, 'chromium-' + theme);
    await readPDF(file, 'REYZ', accent, baseline);
  }
  await page.screenshot({ path: path.join(OUT, 'mobile-result.png'), fullPage: true });
  const oldHref = await page.locator('#manualDownload').getAttribute('href');
  await page.locator('#manualName').fill('株式会社レイズ');
  check('editing name invalidates previous result', await page.locator('#manualResult').isHidden() && await page.locator('#manualDownload').getAttribute('href') !== oldHref);
  const jp = await generate(page, '株式会社レイズ', 'pink', 'chromium-japanese');
  await readPDF(jp, '株式会社レイズ', '#f715ac', baseline);
  const longName = 'あ'.repeat(24);
  const longPDF = await generate(page, longName, 'purple', 'chromium-max-name');
  await readPDF(longPDF, longName, '#8b5cf6', baseline);
  await page.locator('input[name="theme"][value="green"]').check();
  check('changing color invalidates previous result', await page.locator('#manualResult').isHidden());

  for (const width of [320, 390, 1440]) {
    const viewportContext = await newContext(chrome, { viewport: { width, height: width === 1440 ? 900 : 844 }, isMobile: width !== 1440, hasTouch: width !== 1440 });
    const vp = (await openManual(viewportContext)).page;
    await vp.locator('#manualName').fill('株式会社レイズ');
    const measure = await vp.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, h1: document.querySelectorAll('h1').length, font: parseFloat(getComputedStyle(document.getElementById('manualName')).fontSize), small: Array.from(document.querySelectorAll('a[href],button,input,select,textarea')).filter(x => !x.closest('[hidden]') && getComputedStyle(x).display !== 'none').map(x => ({ id: x.id, width: x.getBoundingClientRect().width, height: x.getBoundingClientRect().height })).filter(x => x.width > 0 && (x.width < 44 || x.height < 44)) }));
    check(width + ': layout and touch targets', measure.scrollWidth <= measure.width && measure.h1 === 1 && measure.font >= 16 && measure.small.length === 0, measure);
    await vp.screenshot({ path: path.join(OUT, `manual-${width}.png`), fullPage: true });
    await viewportContext.close();
  }

  // Real failed fetch, then retry. The first generation is paused to exercise
  // duplicate submission while the form is disabled, rather than racing a timer.
  const recoveryContext = await newContext(chrome);
  let templateAttempts = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await recoveryContext.route('**/assets/manual/template.pdf', async route => {
    templateAttempts++;
    if (templateAttempts === 1) { await gate; return route.fulfill({ status: 503, contentType: 'text/plain', body: 'QA: temporary asset failure' }); }
    return route.continue();
  });
  const recovery = await openManual(recoveryContext);
  const rp = recovery.page;
  await rp.locator('#manualName').fill('REYZ Retry');
  await rp.locator('#manualGenerate').click();
  await rp.waitForFunction(() => document.getElementById('manualOptions').disabled);
  check('busy form prevents user changes', await rp.locator('#manualName').isDisabled() && await rp.locator('#manualGenerate').isDisabled());
  await rp.evaluate(() => document.getElementById('manualForm').requestSubmit());
  release();
  await rp.waitForFunction(() => !document.getElementById('manualOptions').disabled && !!document.getElementById('manualError').textContent.trim(), null, { timeout: 90000 });
  check('fetch failure keeps input and no stale result', await rp.locator('#manualName').inputValue() === 'REYZ Retry' && await rp.locator('#manualResult').isHidden());
  const retried = await generate(rp, 'REYZ Retry', 'blue', 'chromium-retry');
  await readPDF(retried, 'REYZ Retry', '#4169e1', baseline);
  check('failed fetch is retried once', templateAttempts === 2, templateAttempts);
  check('recovery has no unhandled errors', recovery.errors.length === 0, recovery.errors);
  await recoveryContext.close();

  const wk = await webkit.launch(); browsers.push(wk);
  report.browsers.push({ engine: 'webkit', version: wk.version(), device: 'mobile viewport emulation, not a physical iPhone' });
  const wkContext = await newContext(wk);
  const wkPage = await openManual(wkContext);
  const wkFile = await generate(wkPage.page, '株式会社レイズ', 'green', 'webkit-japanese');
  await readPDF(wkFile, '株式会社レイズ', '#168b72', baseline);
  const explicit = wkPage.page.waitForEvent('download', { timeout: 30000 });
  await wkPage.page.locator('#manualDownload').click();
  const explicitDownload = await explicit;
  await explicitDownload.saveAs(path.join(OUT, 'webkit-explicit-save.pdf'));
  check('WebKit explicit save is same generated PDF', sha(fs.readFileSync(wkFile)) === sha(fs.readFileSync(path.join(OUT, 'webkit-explicit-save.pdf'))));
  check('WebKit has no unhandled errors', wkPage.errors.length === 0, wkPage.errors);
  await wkPage.page.screenshot({ path: path.join(OUT, 'webkit-mobile.png'), fullPage: true });
  await wkContext.close();

  check('Chromium has no unhandled errors', errors.length === 0, errors);
  const names = ['REYZ', '株式会社レイズ', 'REYZ Retry'];
  const leaked = report.requests.filter(req => {
    let text = req.url + ' ' + (req.body || '');
    try { text = decodeURIComponent(text); } catch {}
    return names.some(name => text.includes(name));
  });
  check('names never sent in requests', leaked.length === 0, leaked);
  check('no form or API posts', report.requests.every(req => req.method === 'GET'));
  report.requestSummary = { count: report.requests.length, nameLeaks: leaked.length, methods: [...new Set(report.requests.map(x => x.method))] };
  delete report.requests;
  await context.close();
}

(async () => {
  try { await main(); }
  catch (error) { report.fails.push('FATAL: ' + (error.stack || String(error))); }
  finally {
    for (const browser of browsers) await browser.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.fails.length) process.exitCode = 1;
})();
