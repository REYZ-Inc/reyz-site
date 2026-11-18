// Real-browser FIELD acceptance.
// The home hero is native 3D video; /ai exercises the remaining particle renderer. No renderer, shader, pixel, RAF or clock mocks.
// The fault cases only deny context creation; surviving contexts remain native.
// Usage: node qa/field_check.js [SITE] [OUT]
// Optional: BASE_URL=https://preview.example/ OUT_DIR=qa/out/field
// Defaults: SITE=site; OUT=OUT_DIR || $QA_OUT/field || qa/out/field.
// Run before v8_check.js: this verifies the readPixels contract used by its
// unchanged chapter / overlap / containment assertions.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(process.argv[2] || 'site');
const OUT = path.resolve(process.argv[3] || process.env.OUT_DIR || path.join(process.env.QA_OUT || 'qa/out', 'field'));
const report = { checks: 0, fails: [], browsers: [], cases: [],
  evidence: 'Native canvas pixels, native draw calls, browser media emulation and WEBGL_lose_context.',
  fonts: 'Remote Google Fonts CSS is empty in this focused test; local assets and all rendering APIs remain native.',
};
const browsers = [];
let server, base;

function check(result, label, ok, details) {
  report.checks++;
  result.checks.push({ label, pass: !!ok });
  if (!ok) report.fails.push(result.id + ': ' + label + (details === undefined ? '' : ': ' + JSON.stringify(details)));
  return !!ok;
}
function serve(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end(); }
  let file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// Count actual graphics work only for #field. Other canvases, clocks and RAF
// stay untouched. Counting clears catches an otherwise invisible empty loop.
function observeNativeRendering(denied) {
  const probe = window.__fieldProbe = { glDraws: 0, canvasDraws: 0, clears: 0, losses: 0,
    created: [], denied: [], shaderErrors: [] };
  const original = HTMLCanvasElement.prototype.getContext;
  const seen = new WeakSet();
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    if (this.id === 'field' && ((denied === 'webgl2' && type === 'webgl2')
      || (denied === 'gpu' && (type === 'webgl2' || type === 'webgl')))) {
      probe.denied.push(type); return null;
    }
    const context = Reflect.apply(original, this, [type, ...args]);
    if (this.id !== 'field' || !context || seen.has(context)) return context;
    seen.add(context); probe.created.push(type);
    const count = (method, key) => {
      const native = context[method];
      context[method] = function (...values) { probe[key]++; return Reflect.apply(native, this, values); };
    };
    if (type === '2d') { count('drawImage', 'canvasDraws'); count('stroke', 'canvasDraws'); count('clearRect', 'clears'); }
    else {
      count('drawArrays', 'glDraws'); count('clear', 'clears');
      this.addEventListener('webglcontextlost', () => { probe.losses++; });
      const compile = context.compileShader, link = context.linkProgram;
      context.compileShader = function (shader) {
        Reflect.apply(compile, this, [shader]);
        if (!this.getShaderParameter(shader, this.COMPILE_STATUS)) probe.shaderErrors.push(this.getShaderInfoLog(shader));
      };
      context.linkProgram = function (program) {
        Reflect.apply(link, this, [program]);
        if (!this.getProgramParameter(program, this.LINK_STATUS)) probe.shaderErrors.push(this.getProgramInfoLog(program));
      };
    }
    return context;
  };
}

// Compare every returned byte against a fresh native read of the SAME canvas,
// in the same JS turn. Only GPU rows are reversed: its origin is bottom-left.
function actualPixels(selector) {
  const observedAt = performance.now();
  const beforeRead = { ...window.__fieldProbe };
  const pixels = window.REYZField.readPixels();
  const canvas = document.getElementById('field'), state = window.REYZField.state();
  const { width, height, data } = pixels;
  const dimensions = width === canvas.width && height === canvas.height && data.length === width * height * 4;
  let native, same = dimensions, glError = 0;
  const gpu = state.renderer === 'webgl2' || state.renderer === 'webgl';
  if (gpu) {
    const gl = canvas.getContext(state.renderer);
    native = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, native);
    glError = gl.getError();
  } else if (state.renderer === 'canvas2d') native = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  else { native = new Uint8Array(canvas.width * canvas.height * 4); same = false; }
  for (let row = 0; same && row < height; row++) {
    const other = (gpu ? height - row - 1 : row) * width * 4;
    for (let col = 0; col < width * 4; col++) if (data[row * width * 4 + col] !== native[other + col]) { same = false; break; }
  }
  let lit = 0, minx = width, maxx = -1, miny = height, maxy = -1, peakAlpha = 0;
  let red = 0, green = 0, blue = 0, hash = 2166136261;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 4; c++) hash = Math.imul(hash ^ data[i + c], 16777619);
    peakAlpha = Math.max(peakAlpha, data[i + 3]);
    if (data[i + 3] <= 40) continue; // Exactly the existing v8 alpha threshold.
    lit++; red += data[i]; green += data[i + 1]; blue += data[i + 2];
    const index = i / 4, x = index % width, y = Math.floor(index / width);
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
  }
  const dpr = width / innerWidth;
  const bbox = lit ? { x: minx / dpr, y: miny / dpr, w: (maxx - minx) / dpr, h: (maxy - miny) / dpr } : null;
  const element = document.querySelector(selector), rect = element && element.getBoundingClientRect();
  const slot = rect ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height } : null;
  let inSlot = 0;
  if (bbox && slot && bbox.w * bbox.h > 0) {
    const w = Math.max(0, Math.min(bbox.x + bbox.w, slot.x + slot.w) - Math.max(bbox.x, slot.x));
    const h = Math.max(0, Math.min(bbox.y + bbox.h, slot.y + slot.h) - Math.max(bbox.y, slot.y));
    inSlot = w * h / (bbox.w * bbox.h);
  }
  return { state, observedAt, beforeRead, frameCheckpoint: window.__fieldFrameCheckpoint,
    scrollY, viewport: { width: innerWidth, height: innerHeight },
    width, height, byteLength: data.length, dimensions, nativeSame: same, glError,
    checksum: (hash >>> 0).toString(16), lit, peakAlpha, bbox, slot, inSlot,
    meanColor: lit ? [red / lit, green / lit, blue / lit] : null };
}

const probeState = () => ({ state: window.REYZField.state(),
  work: window.__fieldProbe.glDraws + window.__fieldProbe.canvasDraws + window.__fieldProbe.clears,
  probe: { ...window.__fieldProbe } });
async function open(page, route) {
  await page.goto(new URL(route, base).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.REYZField && window.REYZField.state().width > 1);
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
  // Let the existing 1.2s intro and 1.5s start-at-top settle window complete.
  await page.waitForTimeout(1750);
  // Inspect a frame that the browser has actually delivered after that deadline,
  // not the old cold-start buffer. This neither advances the renderer nor changes
  // its clock; failure to deliver a native frame within 5s fails the case.
  await page.evaluate(() => {
    window.__fieldFrameCheckpoint = { requestedAt: performance.now(), deliveredAt: null };
    requestAnimationFrame(() => { window.__fieldFrameCheckpoint.deliveredAt = performance.now(); });
  });
  await page.waitForFunction(() => window.__fieldFrameCheckpoint.deliveredAt !== null, undefined, { polling: 25, timeout: 5000 });
}
async function capture(page, result, name) {
  const file = result.id + '-' + name + '.png';
  await page.screenshot({ path: path.join(OUT, file) }); result.screenshots.push(file);
}
async function measure(page, result, name, selector = '[data-word]') {
  const pixels = await page.evaluate(actualPixels, selector); result.observations[name] = pixels;
  check(result, name + ': dimensions match actual canvas', pixels.dimensions, pixels);
  check(result, name + ': every RGBA byte matches native canvas with top-left origin', pixels.nativeSame, pixels);
  check(result, name + ': no GPU read/draw error', pixels.glError === 0, pixels.glError);
  check(result, name + ': field controller remains healthy', !pixels.state.failed && pixels.state.renderer !== 'none', pixels.state);
  return pixels;
}
function visible(result, label, pixels, containment = 0.95) {
  check(result, label + ': initial scatter has completed on the actual-time deadline', pixels.state.introProgress === 1 && !pixels.state.gathering, pixels.state);
  check(result, label + ': actual light pixels exist', pixels.lit > 100, pixels.lit);
  check(result, label + ': shape remains inside its slot', pixels.inSlot >= containment, { bbox: pixels.bbox, slot: pixels.slot, inSlot: pixels.inSlot });
  const color = pixels.meanColor;
  check(result, label + ': light retains pink dominance', color && color[0] > color[1] * 1.15 && color[2] > color[1] * 1.15, color);
}
async function stopped(page, result, label) {
  await page.waitForTimeout(200);
  const before = await page.evaluate(probeState);
  await page.waitForTimeout(350); // No pixel reads here: those intentionally draw once.
  const after = await page.evaluate(probeState);
  result.observations[label + '-native-work'] = { before, after };
  check(result, label + ': controller has stopped continuous RAF', !before.state.running && !after.state.running, after.state);
  check(result, label + ': native draws AND clears stop', before.work === after.work, { before: before.work, after: after.work });
}
async function resumed(page, result, label) {
  await page.waitForFunction(() => window.REYZField.state().running && !window.REYZField.state().reducedMotion);
  const before = await page.evaluate(probeState);
  await page.waitForTimeout(350);
  const after = await page.evaluate(probeState);
  result.observations[label + '-native-work'] = { before, after };
  check(result, label + ': visible motion resumes native rendering', after.work > before.work && after.state.running && after.state.inView, { before, after });
}
async function reduced(page, result, label) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.REYZField.state().reducedMotion);
  await stopped(page, result, label);
  const a = await measure(page, result, label + '-still-a');
  await page.waitForTimeout(250);
  const b = await measure(page, result, label + '-still-b');
  check(result, label + ': reduced-motion pixels stay identical', a.checksum === b.checksum, [a.checksum, b.checksum]);
  const copies = await page.locator('.copy').evaluateAll(elements => elements.map(element => ({
    opacity: Number(getComputedStyle(element).opacity), transform: element.style.transform,
  })));
  check(result, label + ': all copy remains readable without movement', copies.every(copy => copy.opacity >= 0.99 && !copy.transform), copies);
  return b;
}
async function runCase(browser, id, options, denied, action) {
  const result = { id, checks: [], observations: {}, screenshots: [], errors: [], console: [], failedRequests: [] };
  report.cases.push(result);
  let context, page;
  try {
    context = await browser.newContext({ reducedMotion: 'no-preference', ...options });
    await context.addInitScript(observeNativeRendering, denied);
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => result.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(message.text())) result.console.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === new URL(base).origin) result.failedRequests.push(response.status() + ' ' + response.url()); });
    await action(page, result);
  } catch (error) {
    check(result, 'case completed without exception', false, String(error));
    if (page) await capture(page, result, 'failure').catch(() => {});
  } finally {
    if (page) {
      const probe = await page.evaluate(() => window.__fieldProbe).catch(() => null);
      result.lastProbe = probe;
      check(result, 'native shader compile/link errors are absent', !!probe && probe.shaderErrors.length === 0, probe && probe.shaderErrors);
    }
    check(result, 'page errors are absent', result.errors.length === 0, result.errors);
    check(result, 'console errors are absent', result.console.length === 0, result.console);
    check(result, 'same-origin assets load', result.failedRequests.length === 0, result.failedRequests);
    if (context) await context.close();
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  try {
    if (process.env.BASE_URL) {
      const url = new URL(process.env.BASE_URL);
      if (!/^https?:$/.test(url.protocol)) throw new Error('BASE_URL must use HTTP or HTTPS');
      url.search = ''; url.hash = ''; if (!url.pathname.endsWith('/')) url.pathname += '/'; base = url.href;
    } else {
      server = http.createServer(serve);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      base = `http://127.0.0.1:${server.address().port}/`;
    }
    report.base = base;
    const chromeOptions = process.env.QA_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.QA_CHROMIUM_EXECUTABLE_PATH } : {};
    const chrome = await chromium.launch(chromeOptions); browsers.push(chrome);
    report.browsers.push({ engine: 'chromium', version: chrome.version() });

    await runCase(chrome, 'chromium-desktop', { viewport: { width: 1440, height: 900 } }, '', async (page, result) => {
      await open(page, 'ai');
      const first = await measure(page, result, 'gpu'); visible(result, 'gpu', first);
      check(result, 'normal CI browser selects WebGL2 without fallback', first.state.renderer === 'webgl2' && !first.state.fallbackReason, first.state);
      await capture(page, result, 'gpu');
      await reduced(page, result, 'dynamic-reduce');
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await resumed(page, result, 'dynamic-resume');
      const beforeLoss = await reduced(page, result, 'before-loss');
      const supported = await page.evaluate(() => {
        const canvas = document.getElementById('field'), state = window.REYZField.state();
        if (state.renderer !== 'webgl2' && state.renderer !== 'webgl') return false;
        const extension = canvas.getContext(state.renderer).getExtension('WEBGL_lose_context');
        if (!extension) return false;
        window.__fieldBeforeLoss = canvas; extension.loseContext(); return true;
      });
      if (!check(result, 'native WEBGL_lose_context extension is available', supported)) return;
      await page.waitForFunction(() => window.REYZField.state().renderer === 'canvas2d');
      const replacement = await page.evaluate(() => ({ replaced: window.__fieldBeforeLoss !== document.getElementById('field'),
        lossEvents: window.__fieldProbe.losses, count: document.querySelectorAll('#field').length,
        decorative: document.getElementById('field').getAttribute('aria-hidden') }));
      check(result, 'actual loss replaces the locked canvas exactly once and keeps it decorative', replacement.replaced && replacement.lossEvents === 1 && replacement.count === 1 && replacement.decorative === 'true', replacement);
      const afterLoss = await measure(page, result, 'lost-context-2d'); visible(result, 'lost-context-2d', afterLoss);
      check(result, 'context-loss reason is explicit', afterLoss.state.fallbackReason === 'context-lost', afterLoss.state);
      const a = beforeLoss.bbox, b = afterLoss.bbox;
      check(result, 'fallback preserves the frozen shape position and extent', a && b && ['x', 'y', 'w', 'h'].every(key => Math.abs(a[key] - b[key]) <= 6), { gpu: a, canvas2d: b });
      await stopped(page, result, 'fallback-reduced'); await capture(page, result, 'context-loss');
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await resumed(page, result, 'fallback-resume');
    });

    const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
    await runCase(chrome, 'chromium-mobile', { ...mobile, reducedMotion: 'reduce' }, '', async (page, result) => {
      await open(page, 'ai');
      const first = await measure(page, result, 'initial-reduced'); visible(result, 'initial-reduced', first);
      check(result, 'initial reduced preference is honored on a high-DPI canvas', first.state.reducedMotion && first.width === 780 && first.height === 1688, first);
      await stopped(page, result, 'initial-reduced'); await capture(page, result, 'initial-reduced');
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await resumed(page, result, 'initial-reduced-resume');
      await open(page, 'manual');
      await page.waitForFunction(() => !window.REYZField.state().running && !window.REYZField.state().inView);
      const top = await measure(page, result, 'manual-top', '.foot-slot');
      check(result, 'manual starts at top with its field entirely below the viewport', top.scrollY === 0 && top.slot && top.slot.y >= top.viewport.height && top.peakAlpha === 0 && !top.state.reducedMotion, top);
      await stopped(page, result, 'manual-offscreen');
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await resumed(page, result, 'manual-footer'); await page.waitForTimeout(900);
      const footer = await measure(page, result, 'manual-footer', '.foot-slot'); visible(result, 'manual-footer', footer, 0.99);
      await capture(page, result, 'manual-footer');
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForFunction(() => !window.REYZField.state().running && !window.REYZField.state().inView);
      const returned = await measure(page, result, 'manual-returned', '.foot-slot');
      check(result, 'returning to manual top clears the real field buffer', returned.peakAlpha === 0, returned);
      await stopped(page, result, 'manual-returned');
    });

    await runCase(chrome, 'chromium-webgl1', { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }, 'webgl2', async (page, result) => {
      await open(page, 'ai');
      const pixels = await measure(page, result, 'webgl1'); visible(result, 'webgl1', pixels);
      check(result, 'denying WebGL2 exercises actual WebGL1 shaders', pixels.state.renderer === 'webgl' && !pixels.state.fallbackReason, pixels.state);
      await stopped(page, result, 'webgl1-reduced');
    });
    await runCase(chrome, 'chromium-no-gpu', { ...mobile, reducedMotion: 'reduce' }, 'gpu', async (page, result) => {
      await open(page, 'ai');
      const pixels = await measure(page, result, 'native-2d'); visible(result, 'native-2d', pixels);
      check(result, 'denying GPU contexts selects a real Canvas2D fallback', pixels.state.renderer === 'canvas2d' && pixels.state.fallbackReason === 'webgl-unavailable', pixels.state);
      await stopped(page, result, 'canvas2d-reduced'); await capture(page, result, 'native-2d');
      await page.click('#menuBtn');
      check(result, 'navigation still opens after GPU creation failure', await page.locator('#sheet').isVisible());
      await page.keyboard.press('Escape');
      check(result, 'navigation still closes after GPU creation failure', await page.locator('#sheet').isHidden());
    });

    const wk = await webkit.launch(); browsers.push(wk); report.browsers.push({ engine: 'webkit', version: wk.version() });
    await runCase(wk, 'webkit-mobile', mobile, '', async (page, result) => {
      await open(page, 'ai');
      const pixels = await measure(page, result, 'webkit'); visible(result, 'webkit', pixels);
      await capture(page, result, 'initial-normal');
      // Linux WebKit may expose no GPU context. Its native 2D fallback must still
      // draw; Chromium above must pass the strict WebGL2 AND WebGL1 shader gates.
      check(result, 'WebKit selects a working native renderer', ['webgl2', 'webgl', 'canvas2d'].includes(pixels.state.renderer), pixels.state);
      await reduced(page, result, 'webkit-reduce'); await capture(page, result, 'reduced');
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await resumed(page, result, 'webkit-resume');
    });
  } catch (error) { report.fails.push('field suite setup/execution: ' + String(error)); }
  finally {
    for (const browser of browsers) await browser.close().catch(() => {});
    if (server && server.listening) await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.fails.length) process.exitCode = 1;
  }
})();
