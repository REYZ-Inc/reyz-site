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
  const defaultTheme = themes.find(theme => theme.id === 'pink') || themes[0];
  let currentTheme = defaultTheme;
  let objectUrl = null;
  let currentFile = null;
  let activeRequest = null;
  let generation = 0;
  let previewReady = false;
  let fitFrame = 0;
  const previewFontLoads = new Map();

  function setError(message = '', fieldError = false) {
    errorBox.textContent = message;
    if (fieldError) nameInput.setAttribute('aria-invalid', 'true');
    else nameInput.removeAttribute('aria-invalid');
  }

  function invalidateResult() {
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
    if (!busy) activeRequest = null;
  }

  function fitPreviewName() {
    if (!previewReady) return;
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      const checked = validateName(nameInput.value);
      const label = checked.normalized || nameInput.value.trim().normalize('NFC') || 'YOUR NAME';
      // Match the PDF's whole-name font selection, including mixed Japanese/Latin names.
      const family = /^[\x20-\x7e]+$/.test(label) ? 'Manual Poppins' : 'Manual Noto JP';
      cover.style.setProperty('--manual-name-font', `"${family}"`);
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
    });
  }

  function applyTheme(theme) {
    currentTheme = theme;
    for (const key of ['accent', 'blush', 'soft', 'line', 'deep', 'chip']) {
      document.body.style.setProperty(`--manual-${key}`, theme[key]);
    }
    themeLabel.textContent = theme.label;
    preview.dataset.theme = theme.id;
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
    applyTheme(themes.find(theme => theme.id === selected?.value) || defaultTheme);
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
          if (Number.isFinite(value)) progress.value = Math.min(100, Math.max(0, value));
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
    if (activeRequest) { generation++; activeRequest.abort(); setBusy(false); }
    // Back/forward cache can restore this UI with its result still usable.
    if (!event.persisted) invalidateResult();
  });
  addPalettes();
  applyTheme(defaultTheme);
  options.disabled = false;
  loadPreview();
}
