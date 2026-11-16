import { themes, validateName, ManualError } from './manual-config.js';

const workerURL = new URL('./manual/manual-worker.js', import.meta.url);
const generationTimeoutMilliseconds = 120000;

/** Generate the personalized PDF in an isolated worker; no name is transmitted. */
export async function generateManual({ name, themeId = 'pink', onProgress, signal } = {}) {
  const validation = validateName(name);
  if (!validation.valid) throw new ManualError(validation.message, validation.code);
  if (!themes.some(theme => theme.id === themeId)) throw new ManualError('配色を選び直してください。', 'invalid-name');
  if (signal?.aborted) throw new DOMException('生成をキャンセルしました。', 'AbortError');

  return new Promise((resolve, reject) => {
    let worker;
    let timeout;
    let settled = false;
    const controller = new AbortController();
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      controller.abort();
      worker?.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const cancel = () => finish(new DOMException('生成をキャンセルしました。', 'AbortError'));
    const progress = update => { if (!settled) onProgress?.(update); };
    const runWithoutWorker = () => {
      import('./manual/manual-core.js')
        .then(({ createManual }) => {
          if (settled) return;
          return createManual({ name: validation.normalized, themeId, onProgress: progress, signal: controller.signal });
        })
        .then(result => finish(null, result), error => finish(error));
    };
    // Cover worker/module startup as well as asset loading and PDF creation.
    // A stalled dependency must leave the form available for another attempt.
    timeout = setTimeout(() => finish(new ManualError('PDFの作成に時間がかかりすぎました。通信環境を確認し、もう一度お試しください。', 'timeout')), generationTimeoutMilliseconds);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    if (typeof Worker === 'undefined') { runWithoutWorker(); return; }
    try {
      worker = new Worker(workerURL, { type: 'module', name: 'manual-pdf' });
    } catch {
      // Browsers that disable workers can still generate locally. This branch
      // is only for worker construction failures, never a failed PDF operation.
      runWithoutWorker();
      return;
    }
    worker.onmessage = ({ data }) => {
      if (settled) return;
      if (data?.type === 'progress') progress(data.progress);
      else if (data?.type === 'complete') finish(null, { bytes: new Uint8Array(data.buffer), fileName: data.fileName, pageCount: data.pageCount });
      else if (data?.type === 'error') finish(new ManualError(data.userMessage || 'PDFを生成できませんでした。もう一度お試しください。', data.code));
    };
    worker.onerror = () => finish(new ManualError('PDF生成の準備を読み込めませんでした。通信を確認し、もう一度お試しください。', 'worker'));
    worker.onmessageerror = () => finish(new ManualError('PDF生成の結果を受け取れませんでした。もう一度お試しください。', 'worker'));
    try { worker.postMessage({ name: validation.normalized, themeId }); }
    catch { finish(new ManualError('PDF生成を開始できませんでした。もう一度お試しください。', 'worker')); }
  });
}
