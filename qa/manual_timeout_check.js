// Actual UI/engine modules, evaluated with DOM/Worker mocks and virtual timers.
// This checks cancellation and stale-result state transitions. It does NOT test
// browser downloads, PDF rendering, WebKit or a physical iPhone; manual_check.js
// remains the separate browser/PDF acceptance gate.
// Run: node --experimental-vm-modules qa/manual_timeout_check.js site
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(process.argv[2] || 'site');
const passed = [];
const tick = () => new Promise(setImmediate);
let config, engineSource, uiSource;

// A regression must fail this probe instead of hanging the CI job itself.
async function runCase(label, operation) {
  let timer;
  try {
    await Promise.race([
      operation(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: probe did not settle within 5 seconds`)), 5000);
      }),
    ]);
    passed.push(label);
  } finally { clearTimeout(timer); }
}

function fakeClock() {
  let sequence = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fireDeadline() {
      const entry = [...timers].find(([, timer]) => timer.ms === 120000);
      assert.ok(entry, 'A 120-second deadline must exist');
      timers.delete(entry[0]);
      entry[1].fn();
    },
  };
}

function configModule(context, exports) {
  return new vm.SyntheticModule(exports, function () {
    for (const name of exports) this.setExport(name, config[name]);
  }, { context });
}

async function engineCase(mode, outcome) {
  const clock = fakeClock();
  let worker, coreSignal, progressCount = 0;
  class FakeWorker {
    constructor() {
      if (mode.startsWith('constructor-')) throw new Error('worker unavailable');
      worker = this;
      this.terminated = false;
    }
    terminate() { this.terminated = true; }
    postMessage() {
      if (mode === 'post-throws') throw new Error('send failed');
      if (mode === 'worker-success') queueMicrotask(() => this.onmessage({ data: {
        type: 'complete', buffer: new Uint8Array([37, 80, 68, 70]).buffer, fileName: 'test.pdf', pageCount: 42,
      } }));
      if (mode === 'worker-error') queueMicrotask(() => this.onerror());
      if (mode === 'worker-message-error') queueMicrotask(() => this.onmessageerror());
      if (mode === 'worker-operation-error') queueMicrotask(() => this.onmessage({ data: {
        type: 'error', userMessage: 'fetch failed', code: 'network',
      } }));
    }
  }
  const globals = { URL, DOMException, AbortController, Uint8Array, queueMicrotask, ...clock };
  if (!mode.startsWith('absent-')) globals.Worker = FakeWorker;
  const context = vm.createContext(globals);
  const linkedConfig = configModule(context, ['themes', 'validateName', 'ManualError']);
  const core = new vm.SyntheticModule(['createManual'], function () {
    this.setExport('createManual', ({ signal, onProgress }) => {
      coreSignal = signal;
      if (mode.endsWith('-success')) return Promise.resolve({
        bytes: new Uint8Array([37, 80, 68, 70]), fileName: 'fallback.pdf', pageCount: 42,
      });
      if (mode.endsWith('-error')) return Promise.reject(new config.ManualError('asset error', 'network'));
      onProgress?.({ value: 8, label: 'loading' });
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true }));
    });
  }, { context });
  await core.link(() => {});
  await core.evaluate();
  const module = new vm.SourceTextModule(engineSource, {
    context,
    initializeImportMeta(meta) { meta.url = pathToFileURL(path.join(ROOT, 'assets/manual-engine.js')).href; },
    async importModuleDynamically(specifier) {
      assert.equal(specifier, './manual/manual-core.js');
      return mode.endsWith('-import-stall') ? new Promise(() => {}) : core;
    },
  });
  await module.link(specifier => { assert.equal(specifier, './manual-config.js'); return linkedConfig; });
  await module.evaluate();
  const controller = new AbortController();
  let added = 0, removed = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { added++; return add(...args); };
  controller.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  const pending = module.namespace.generateManual({
    name: 'Retry Studio', signal: controller.signal, onProgress: () => progressCount++,
  }).then(result => ({ result }), error => ({ error }));
  await tick();
  if (outcome === 'timeout') clock.fireDeadline();
  else if (outcome === 'abort') controller.abort();
  const value = await pending;
  if (outcome === 'success') assert.equal(value.result?.pageCount, 42);
  else if (outcome === 'abort') assert.equal(value.error?.name, 'AbortError');
  else assert.equal(value.error?.code, outcome);
  assert.equal(clock.timers.size, 0, 'Timer cleanup');
  assert.equal(added, removed, 'Abort listener cleanup');
  if (worker) assert.equal(worker.terminated, true, 'Worker cleanup');
  if (coreSignal) assert.equal(coreSignal.aborted, true, 'Fallback cancellation');
  const count = progressCount;
  worker?.onmessage?.({ data: { type: 'progress', progress: { value: 100 } } });
  assert.equal(progressCount, count, 'No late progress after settlement');
}

async function uiFixture(initialMode) {
  const clock = fakeClock();
  const state = { mode: initialMode, calls: 0, clicks: 0, urls: 0, windows: new Map() };
  class Element {
    constructor() {
      this.listeners = new Map(); this.attrs = new Map(); this.children = [];
      this.style = { setProperty() {} }; this.dataset = {};
      this.hidden = false; this.disabled = false; this.value = ''; this.textContent = '';
    }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    setAttribute(key, value) { this.attrs.set(key, value); }
    removeAttribute(key) { this.attrs.delete(key); if (key === 'href' || key === 'download') delete this[key]; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    querySelector(selector) {
      return selector === 'span' ? this.label : (selector === 'input[name="theme"]:checked' ? { value: 'pink' } : null);
    }
    focus() { this.focused = true; }
    click() { state.clicks++; }
  }
  const ids = ['manualForm', 'manualOptions', 'manualName', 'manualPalettes', 'manualGenerate', 'manualStatus',
    'manualError', 'manualProgress', 'manualResult', 'manualResultDetail', 'manualDownload', 'manualOpen',
    'manualShare', 'manualPreview', 'manualCover', 'manualThemeLabel'];
  const e = Object.fromEntries(ids.map(id => [id, new Element()]));
  e.manualName.value = 'Retry Studio'; e.manualGenerate.label = new Element(); e.manualResult.hidden = true;
  class FakeURL extends URL {
    static createObjectURL() { return 'blob:test-' + (++state.urls); }
    static revokeObjectURL() {}
  }
  const document = {
    getElementById: id => e[id], createDocumentFragment: () => new Element(),
    createElement: () => new Element(), body: new Element(),
  };
  const context = vm.createContext({
    URL: FakeURL, DOMException, AbortController, Blob, File, Uint8Array, document, navigator: { onLine: true },
    window: { addEventListener: (name, fn) => state.windows.set(name, fn) },
    fetch: () => Promise.reject(new Error('Preview is outside this state-transition probe')),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, ...clock,
  });
  const linkedConfig = configModule(context, ['themes', 'validateName']);
  const engine = new vm.SyntheticModule(['generateManual'], function () {
    this.setExport('generateManual', options => {
      state.calls++; state.signal = options.signal; state.progress = options.onProgress;
      if (state.mode === 'engine-error') return Promise.reject(new config.ManualError('Asset failure', 'network'));
      // Deliberately ignore abort here to exercise late-result rejection in the UI.
      if (state.mode === 'engine-wait') return new Promise(resolve => { state.finishEngine = resolve; });
      return Promise.resolve({ bytes: new Uint8Array([37, 80, 68, 70]), fileName: options.name + '.pdf', pageCount: 42 });
    });
  }, { context });
  await engine.link(() => {});
  await engine.evaluate();
  const module = new vm.SourceTextModule(uiSource, {
    context,
    initializeImportMeta(meta) { meta.url = pathToFileURL(path.join(ROOT, 'assets/manual.js')).href; },
    async importModuleDynamically(specifier) {
      assert.equal(specifier, './manual-engine.js');
      if (state.mode === 'import-wait') return new Promise(resolve => { state.finishImport = () => resolve(engine); });
      return engine;
    },
  });
  await module.link(specifier => { assert.equal(specifier, './manual-config.js'); return linkedConfig; });
  await module.evaluate();
  await tick();
  return { state, e, clock, submit: () => e.manualForm.listeners.get('submit')({ preventDefault() {} }) };
}

function idle(fixture) {
  assert.equal(fixture.e.manualOptions.disabled, false, 'Input is available');
  assert.equal(fixture.e.manualForm.attrs.get('aria-busy'), 'false');
  assert.equal(fixture.clock.timers.size, 0, 'Deadline is cleared');
}

const uiCases = {
  async 'import timeout and late import'() {
    const x = await uiFixture('import-wait'), pending = x.submit();
    await tick(); assert.equal(x.e.manualOptions.disabled, true);
    x.clock.fireDeadline(); await pending; idle(x);
    assert.match(x.e.manualError.textContent, /時間がかかりすぎ/);
    assert.equal(x.e.manualResult.hidden, true); assert.equal(x.e.manualName.value, 'Retry Studio');
    x.state.finishImport(); await tick(); assert.equal(x.state.calls, 0);
  },
  async 'generation timeout, retry and late result'() {
    const x = await uiFixture('engine-wait'), pending = x.submit();
    await tick(); const late = x.state.finishEngine, lateProgress = x.state.progress;
    x.clock.fireDeadline(); await pending; idle(x);
    assert.equal(x.state.signal.aborted, true); assert.equal(x.e.manualResult.hidden, true);
    lateProgress({ value: 100, label: 'incorrect completion' }); assert.equal(x.e.manualStatus.textContent, '');
    x.state.mode = 'engine-success'; x.e.manualName.value = 'Recovered Studio';
    await x.submit(); idle(x);
    assert.equal(x.e.manualDownload.download, 'Recovered Studio.pdf'); assert.equal(x.state.clicks, 1);
    late({ bytes: new Uint8Array([1]), fileName: 'STALE.pdf', pageCount: 42 }); await tick();
    assert.equal(x.e.manualDownload.download, 'Recovered Studio.pdf'); assert.equal(x.state.clicks, 1);
  },
  async 'success cleanup'() {
    const x = await uiFixture('engine-success'); await x.submit(); idle(x);
    assert.equal(x.e.manualResult.hidden, false); assert.equal(x.state.clicks, 1);
  },
  async 'error cleanup'() {
    const x = await uiFixture('engine-error'); await x.submit(); idle(x);
    assert.equal(x.e.manualResult.hidden, true); assert.equal(x.e.manualError.textContent, 'Asset failure');
  },
  async 'settings change during import'() {
    const x = await uiFixture('import-wait'), pending = x.submit(); await tick();
    x.e.manualName.listeners.get('input')(); await pending; idle(x); assert.equal(x.e.manualResult.hidden, true);
  },
  async 'page exit during import'() {
    const x = await uiFixture('import-wait'), pending = x.submit(); await tick();
    x.state.windows.get('pagehide')({ persisted: false }); await pending; idle(x); assert.equal(x.e.manualResult.hidden, true);
  },
  async 'duplicate submission'() {
    const x = await uiFixture('engine-wait'), pending = x.submit(); await tick();
    await x.submit(); assert.equal(x.state.calls, 1); x.clock.fireDeadline(); await pending; idle(x);
  },
};

async function main() {
  assert.equal(typeof vm.SourceTextModule, 'function', 'Run node with --experimental-vm-modules');
  config = await import(pathToFileURL(path.join(ROOT, 'assets/manual-config.js')).href);
  engineSource = fs.readFileSync(path.join(ROOT, 'assets/manual-engine.js'), 'utf8');
  uiSource = fs.readFileSync(path.join(ROOT, 'assets/manual.js'), 'utf8');
  for (const [mode, outcome] of [
    ['worker-success', 'success'], ['worker-error', 'worker'], ['worker-message-error', 'worker'],
    ['worker-operation-error', 'network'], ['post-throws', 'worker'], ['worker-silent', 'timeout'], ['worker-cancel', 'abort'],
    ['absent-success', 'success'], ['constructor-success', 'success'], ['absent-error', 'network'], ['constructor-error', 'network'],
    ['absent-silent', 'timeout'], ['constructor-silent', 'timeout'], ['absent-import-stall', 'timeout'],
    ['constructor-import-stall', 'timeout'], ['absent-cancel', 'abort'], ['constructor-cancel', 'abort'],
  ]) await runCase('engine: ' + mode, () => engineCase(mode, outcome));
  for (const [label, operation] of Object.entries(uiCases)) await runCase('UI: ' + label, operation);
}

main().then(() => {
  console.log(JSON.stringify({ mode: 'DOM/Worker mocks + virtual timers; not browser or PDF-rendering QA', scenariosPassed: passed.length, passed, fails: [] }, null, 2));
}).catch(error => {
  console.log(JSON.stringify({ mode: 'DOM/Worker mocks + virtual timers; not browser or PDF-rendering QA', scenariosPassed: passed.length, passed, fails: [error.stack || String(error)] }, null, 2));
  process.exitCode = 1;
});
