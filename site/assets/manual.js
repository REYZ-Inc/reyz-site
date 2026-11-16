import { themes, validateName } from './manual-config.js';

// UI only. PDF libraries, the template and embedding fonts are loaded on submit.
const form = document.getElementById('manualForm');
if (form) {
  const options = document.getElementById('manualOptions');
  const nameInput = document.getElementById('manualName');
  const paletteList = document.getElementById('manualPalettes');
  const generateButton = document.getElementById('manualGenerate');
  const generateLabel = generateButton.querySelector('span');
  const status = document.getElementById('manualStatus');
  const errorBox = document.getElementById('manualError');
  const progress = document.getElementById('manualProgress');
  const resultBox = document.getElementById('manualResult');
  const resultDetail = document.getElementById('manualResultDetail');
  const download = document.getElementById('manualDownload');
  const open = document.getElementById('manualOpen');
  const share = document.getElementById('manualShare');
  const preview = document.getElementById('manualPreview');
  const cover = document.getElementById('manualCover');
  const themeLabel = document.getElementById('manualThemeLabel');
  const book = preview.querySelector('.manual-book');
  const readButton = document.getElementById('manualRead');
  const reader = document.getElementById('manualReader');
  const readerPage = document.getElementById('manualReaderPage');
  const readerTitle = document.getElementById('manualReaderTitle');
  const readerCount = document.getElementById('manualReaderCount');
  const readerStatus = document.getElementById('manualReaderStatus');
  const readerPrev = document.getElementById('manualReaderPrev');
  const readerNext = document.getElementById('manualReaderNext');
  const readerClose = document.getElementById('manualReaderClose');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || { matches: true, addEventListener() {} };
  const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)') || { matches: false, addEventListener() {} };
  const defaultTheme = themes.find(theme => theme.id === 'pink') || themes[0];
  let currentTheme = defaultTheme;
  let objectUrl = null;
  let currentFile = null;
  let activeRequest = null;
  let generation = 0;
  let previewReady = false;
  let fitFrame = 0;
  let bookMotion = null;
  let tiltFrame = 0;
  let readerIndex = 0;
  let readerRequest = 0;
  let readerManifestPromise = null;
  let readerPages = [];
  const previewFontLoads = new Map();
  const readerSources = new Map();

  function setError(message = '', fieldError = false) {
    errorBox.textContent = message;
    if (fieldError) nameInput.setAttribute('aria-invalid', 'true');
    else nameInput.removeAttribute('aria-invalid');
  }

  function invalidateResult() {
    delete preview.dataset.completed;
    resultBox.hidden = true;
    download.removeAttribute('href');
    download.removeAttribute('download');
    download.removeAttribute('target');
    download.removeAttribute('rel');
    open.removeAttribute('href');
    open.removeAttribute('target');
    open.removeAttribute('rel');
    share.hidden = true;
    currentFile = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function setBusy(busy) {
    options.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
    generateLabel.textContent = busy ? 'PDFをつくっています' : 'PDFをダウンロード';
    progress.hidden = !busy;
    preview.dataset.generating = String(busy);
    if (busy) preview.style.setProperty('--manual-progress', '0');
    if (!busy) activeRequest = null;
  }

  function fitPreviewName() {
    if (!previewReady && !readerPage?.querySelector('svg')) return;
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      const checked = validateName(nameInput.value);
      const label = checked.normalized || nameInput.value.trim().normalize('NFC') || 'YOUR NAME';
      // Match the PDF's whole-name font selection, including mixed Japanese/Latin names.
      const family = /^[\x20-\x7e]+$/.test(label) ? 'Manual Poppins' : 'Manual Noto JP';
      cover.style.setProperty('--manual-name-font', `"${family}"`);
      if (readerPage) readerPage.style.setProperty('--manual-name-font', `"${family}"`);
      if (document.fonts && !previewFontLoads.has(family)) {
        const loaded = document.fonts.load(`700 16px "${family}"`, label);
        previewFontLoads.set(family, loaded);
        loaded.then(fitPreviewName).catch(() => { previewFontLoads.delete(family); });
      }
      for (const [id, fallbackSize, fallbackWidth] of [
        ['manual-cover-name-top', 16, 350],
        ['manual-cover-name-bottom', 27, 172.557]
      ]) {
        const node = cover.querySelector(`#${id}`);
        if (!node) continue;
        node.textContent = label;
        const size = Number(node.dataset.baseSize) || fallbackSize;
        const width = Number(node.dataset.maxWidth) || fallbackWidth;
        node.setAttribute('font-size', String(size));
        const measured = node.getComputedTextLength();
        if (measured > width) node.setAttribute('font-size', String(size * width / measured));
      }
      preview.dataset.name = label;
      if (readerPage?.querySelector('svg')) {
        for (const node of readerPage.querySelectorAll('[data-manual-name]')) {
          node.textContent = label;
          const size = Number(node.dataset.baseSize);
          const width = Number(node.dataset.maxWidth);
          node.setAttribute('font-size', String(size));
          const measured = node.getComputedTextLength();
          if (measured > width) node.setAttribute('font-size', String(size * width / measured));
        }
        const sample = readerPages[readerIndex];
        readerPage.setAttribute('aria-label', [label, sample?.title, sample?.description].filter(Boolean).join('。'));
        readerPage.dataset.name = label;
      }
    });
  }

  function applyTheme(theme) {
    currentTheme = theme;
    for (const key of ['accent', 'blush', 'soft', 'line', 'deep', 'chip']) {
      document.body.style.setProperty(`--manual-${key}`, theme[key]);
    }
    themeLabel.textContent = theme.label;
    preview.dataset.theme = theme.id;
    if (readerPage) readerPage.dataset.theme = theme.id;
  }

  function settingsChanged() {
    if (activeRequest) {
      generation++;
      activeRequest.abort();
      setBusy(false);
    }
    invalidateResult();
    setError();
    status.textContent = '';
    const selected = form.querySelector('input[name="theme"]:checked');
    const nextTheme = themes.find(theme => theme.id === selected?.value) || defaultTheme;
    const colorChanged = nextTheme.id !== currentTheme.id;
    applyTheme(nextTheme);
    if (colorChanged && book && !reducedMotion.matches && book.animate) {
      bookMotion?.cancel();
      bookMotion = book.animate([{ opacity: 0.86 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    }
    fitPreviewName();
  }

  function addPalettes() {
    const fragment = document.createDocumentFragment();
    for (const theme of themes) {
      const label = document.createElement('label');
      label.className = 'manual-palette';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'theme';
      input.value = theme.id;
      input.id = `manual-theme-${theme.id}`;
      input.checked = theme.id === defaultTheme.id;
      const body = document.createElement('span');
      body.className = 'manual-palette-body';
      body.style.setProperty('--palette-wash', theme.accent + '12');
      const swatches = document.createElement('span');
      swatches.className = 'manual-palette-swatches';
      swatches.setAttribute('aria-hidden', 'true');
      for (const color of [theme.accent, theme.blush]) {
        const dot = document.createElement('i');
        dot.style.backgroundColor = color;
        swatches.append(dot);
      }
      const text = document.createElement('span');
      text.className = 'manual-palette-name';
      text.textContent = theme.label;
      body.append(swatches, text);
      label.append(input, body);
      fragment.append(label);
    }
    paletteList.replaceChildren(fragment);
  }

  async function loadPreview() {
    cover.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(new URL('./manual/cover.svg', import.meta.url));
      if (!response.ok) throw new Error('preview');
      const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
      const svg = doc.documentElement;
      if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('preview');
      // This is a versioned, same-origin template. Free input is added only as textContent.
      const rendered = document.importNode(svg, true);
      rendered.setAttribute('aria-hidden', 'true');
      rendered.setAttribute('focusable', 'false');
      cover.replaceChildren(rendered);
      previewReady = true;
      preview.dataset.ready = 'true';
      fitPreviewName();
    } catch {
      previewReady = false;
      const box = document.createElement('div');
      box.className = 'manual-cover-loading';
      const label = document.createElement('span');
      label.textContent = '表紙を表示できませんでした';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'manual-open';
      retry.textContent = 'もう一度表示する';
      retry.addEventListener('click', loadPreview, { once: true });
      box.append(label, retry);
      cover.replaceChildren(box);
    } finally {
      cover.setAttribute('aria-busy', 'false');
    }
  }

  // The samples are actual pages of the reviewed PDF. Neither the full template
  // nor its generation engine is needed to open this reader.
  async function fetchSampleAsset(filename) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(new URL('./manual/' + filename, import.meta.url), { signal: controller.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error('sample-fetch');
      return await response.arrayBuffer();
    } finally { clearTimeout(timeout); }
  }

  function getSampleManifest() {
    if (!readerManifestPromise) {
      readerManifestPromise = fetchSampleAsset('preview-index.json').then(bytes => {
        const manifest = JSON.parse(new TextDecoder().decode(bytes));
        if (manifest.schema !== 1 || manifest.pageCount !== 42 || !Array.isArray(manifest.pages)
          || !manifest.pages.length || manifest.pages.length > 42
          || !manifest.pages.every(page => Number.isInteger(page.page) && page.page >= 1 && page.page <= 42
            && /^preview-\d{2}\.svg$/.test(page.file) && typeof page.title === 'string'
            && /^[0-9a-f]{64}$/.test(page.sha256) && Number.isSafeInteger(page.bytes) && page.bytes > 0)) {
          throw new Error('sample-manifest');
        }
        readerPages = manifest.pages;
        return manifest;
      }).catch(error => { readerManifestPromise = null; throw error; });
    }
    return readerManifestPromise;
  }

  function getSampleSource(sample) {
    if (!readerSources.has(sample.file)) {
      const loading = fetchSampleAsset(sample.file).then(async bytes => {
        if (bytes.byteLength !== sample.bytes) throw new Error('sample-size');
        if (globalThis.crypto?.subtle) {
          const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          const digest = Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
          if (digest !== sample.sha256) throw new Error('sample-hash');
        }
        const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'image/svg+xml');
        if (doc.documentElement.localName !== 'svg' || doc.querySelector('parsererror, script, foreignObject')) {
          throw new Error('sample-svg');
        }
        return doc.documentElement;
      }).catch(error => {
        readerSources.delete(sample.file);
        if (['sample-size', 'sample-hash'].includes(error.message)) readerManifestPromise = null;
        throw error;
      });
      readerSources.set(sample.file, loading);
    }
    return readerSources.get(sample.file);
  }

  function sampleMessage(message, retry) {
    const box = document.createElement('div');
    box.className = 'manual-reader-loading';
    const copy = document.createElement('p');
    copy.textContent = message;
    box.append(copy);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'manual-reader-retry';
      button.textContent = 'もう一度表示する';
      button.addEventListener('click', () => showSample(readerIndex), { once: true });
      box.append(button);
    }
    readerPage.removeAttribute('role');
    readerPage.removeAttribute('aria-label');
    readerPage.replaceChildren(box);
  }

  async function showSample(index) {
    if (!reader?.open) return;
    const request = ++readerRequest;
    const navigationFocus = [readerPrev, readerNext].includes(document.activeElement) ? document.activeElement : null;
    readerStatus.textContent = 'ページを読み込んでいます。';
    readerPage.setAttribute('aria-busy', 'true');
    readerPrev.disabled = true;
    readerNext.disabled = true;
    sampleMessage('ページを読み込んでいます。', false);
    try {
      const manifest = await getSampleManifest();
      if (request !== readerRequest || !reader.open) return;
      readerIndex = Math.max(0, Math.min(index, manifest.pages.length - 1));
      const sample = manifest.pages[readerIndex];
      readerTitle.textContent = sample.title;
      readerCount.textContent = `${readerIndex + 1} / ${manifest.pages.length}`;
      const source = await getSampleSource(sample);
      if (request !== readerRequest || !reader.open) return;
      const rendered = document.importNode(source, true);
      rendered.setAttribute('aria-hidden', 'true');
      rendered.setAttribute('focusable', 'false');
      readerPage.replaceChildren(rendered);
      readerPage.setAttribute('role', 'img');
      readerPage.dataset.page = String(sample.page);
      readerPage.dataset.theme = currentTheme.id;
      readerPage.closest('.manual-reader-canvas')?.scrollTo({ top: 0, behavior: 'instant' });
      fitPreviewName();
      readerStatus.textContent = `${sample.page}ページ目 · 全${manifest.pageCount}ページから抜粋`;
      if (!reducedMotion.matches && readerPage.animate) {
        readerPage.animate([{ opacity: 0.72, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' });
      }
    } catch {
      if (request !== readerRequest || !reader.open) return;
      readerStatus.textContent = 'ページを表示できませんでした。もう一度お試しください。';
      sampleMessage('ページを表示できませんでした。', true);
    } finally {
      if (request === readerRequest && reader.open) {
        readerPage.setAttribute('aria-busy', 'false');
        readerPrev.disabled = readerIndex <= 0;
        readerNext.disabled = readerIndex >= readerPages.length - 1;
        // Disabling a focused navigation button can move browser focus to body.
        // Restore it only if the visitor has not moved to another dialog control.
        if (navigationFocus && (!reader.contains(document.activeElement) || document.activeElement === reader)) {
          const target = !navigationFocus.disabled ? navigationFocus
            : !readerNext.disabled ? readerNext : !readerPrev.disabled ? readerPrev : readerClose;
          target.focus({ preventScroll: true });
        }
      }
    }
  }

  if (readButton && reader && readerPage && readerClose && readerPrev && readerNext) {
    readButton.addEventListener('click', () => {
      if (!reader.open) reader.showModal();
      document.documentElement.classList.add('manual-reader-open');
      showSample(readerIndex);
    });
    readerClose.addEventListener('click', () => reader.close());
    reader.addEventListener('close', () => {
      readerRequest++;
      document.documentElement.classList.remove('manual-reader-open');
      readButton.focus({ preventScroll: true });
    });
    reader.addEventListener('click', event => {
      if (event.target !== reader) return;
      const rect = reader.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) reader.close();
    });
    readerPrev.addEventListener('click', () => showSample(readerIndex - 1));
    readerNext.addEventListener('click', () => showSample(readerIndex + 1));
    reader.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' && !readerPrev.disabled) { event.preventDefault(); showSample(readerIndex - 1); }
      if (event.key === 'ArrowRight' && !readerNext.disabled) { event.preventDefault(); showSample(readerIndex + 1); }
    });
  }

  // A bounded response to a mouse, with no animation loop or mobile sensors.
  if (book) {
    const resetTilt = () => {
      cancelAnimationFrame(tiltFrame);
      book.style.removeProperty('--book-tilt-x');
      book.style.removeProperty('--book-tilt-y');
    };
    book.addEventListener('pointermove', event => {
      if (!finePointer.matches || reducedMotion.matches) return;
      const rect = book.getBoundingClientRect();
      const x = Math.max(-0.5, Math.min(0.5, (event.clientX - rect.left) / rect.width - 0.5));
      const y = Math.max(-0.5, Math.min(0.5, (event.clientY - rect.top) / rect.height - 0.5));
      cancelAnimationFrame(tiltFrame);
      tiltFrame = requestAnimationFrame(() => {
        book.style.setProperty('--book-tilt-x', `${(-y * 3).toFixed(2)}deg`);
        book.style.setProperty('--book-tilt-y', `${(-4 + x * 5).toFixed(2)}deg`);
      });
    }, { passive: true });
    book.addEventListener('pointerleave', resetTilt);
    reducedMotion.addEventListener('change', resetTilt);
    finePointer.addEventListener('change', resetTilt);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (activeRequest) return;
    setError();
    const checked = validateName(nameInput.value);
    if (!checked.valid) {
      setError(checked.message, true);
      nameInput.focus();
      return;
    }
    nameInput.value = checked.normalized;
    fitPreviewName();
    invalidateResult();
    const request = new AbortController();
    const id = ++generation;
    const selectedTheme = currentTheme;
    activeRequest = request;
    let focusNameAfter = false;
    setBusy(true);
    progress.value = 0;
    status.textContent = 'マニュアルを読み込んでいます。';
    let timeout;
    let rejectAborted;
    const aborted = new Promise((resolve, reject) => { rejectAborted = reject; });
    const cancelWait = () => {
      clearTimeout(timeout);
      rejectAborted(new DOMException('生成をキャンセルしました。', 'AbortError'));
    };
    request.signal.addEventListener('abort', cancelWait, { once: true });
    // This deadline starts before the engine import, so a stalled script cannot
    // keep the form disabled. The generation id also excludes any late result.
    timeout = setTimeout(() => {
      if (generation !== id) return;
      generation++;
      request.abort();
      setBusy(false);
      invalidateResult();
      status.textContent = '';
      setError('PDFの作成に時間がかかりすぎました。通信環境を確認し、もう一度お試しください。');
    }, 120000);
    try {
      const { generateManual } = await Promise.race([import('./manual-engine.js'), aborted]);
      if (request.signal.aborted) return;
      const result = await Promise.race([generateManual({
        name: checked.normalized,
        themeId: selectedTheme.id,
        signal: request.signal,
        onProgress(update) {
          if (generation !== id || request.signal.aborted) return;
          const value = Number(update.value);
          if (Number.isFinite(value)) {
            progress.value = Math.min(100, Math.max(0, value));
            preview.style.setProperty('--manual-progress', String(progress.value / 100));
          }
          if (update.label) status.textContent = update.label;
        }
      }), aborted]);
      if (generation !== id || request.signal.aborted) return;
      const blob = new Blob([result.bytes], { type: 'application/pdf' });
      objectUrl = URL.createObjectURL(blob);
      currentFile = new File([blob], result.fileName, { type: 'application/pdf' });
      download.href = objectUrl;
      download.download = result.fileName;
      download.target = '_blank';
      download.rel = 'noopener';
      open.href = objectUrl;
      open.target = '_blank';
      open.rel = 'noopener';
      resultDetail.textContent = `${checked.normalized} · ${selectedTheme.label} · ${result.pageCount}ページ · ${(blob.size / 1000000).toFixed(1)} MB`;
      resultBox.hidden = false;
      preview.dataset.completed = 'true';
      if (!reducedMotion.matches && resultBox.animate) {
        resultBox.animate([{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 340, easing: 'ease-out' });
      }
      try {
        share.hidden = !(navigator.share && navigator.canShare && navigator.canShare({ files: [currentFile] }));
      } catch { share.hidden = true; }
      status.textContent = 'PDFができました。保存が始まらない場合は、下の「PDFを保存」をタップしてください。';
      download.click();
    } catch (error) {
      if (generation !== id) return;
      invalidateResult();
      status.textContent = '';
      if (error?.name !== 'AbortError') {
        const message = error?.userMessage || (navigator.onLine === false
          ? 'オフラインです。インターネットに接続して、もう一度お試しください。'
          : 'PDFを作成できませんでした。通信環境を確認して、もう一度お試しください。');
        const fieldError = ['invalid-name', 'unsupported-name'].includes(error?.code);
        setError(message, fieldError);
        focusNameAfter = fieldError;
      }
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', cancelWait);
      if (generation === id) {
        setBusy(false);
        if (focusNameAfter) nameInput.focus();
      }
    }
  });

  share.addEventListener('click', async () => {
    if (!currentFile || !navigator.share) return;
    share.disabled = true;
    try {
      // Keep this call in a fresh user gesture; PDF generation has already finished.
      await navigator.share({ files: [currentFile], title: '配信マニュアル' });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setError('この端末では共有できません。「PDFを保存」から保存してください。');
      }
    } finally { share.disabled = false; }
  });

  nameInput.addEventListener('input', settingsChanged);
  paletteList.addEventListener('change', settingsChanged);
  window.addEventListener('resize', fitPreviewName, { passive: true });
  window.addEventListener('pagehide', event => {
    if (reader?.open) reader.close();
    if (activeRequest) { generation++; activeRequest.abort(); setBusy(false); }
    // Back/forward cache can restore this UI with its result still usable.
    if (!event.persisted) invalidateResult();
  });
  addPalettes();
  applyTheme(defaultTheme);
  options.disabled = false;
  loadPreview();
}
