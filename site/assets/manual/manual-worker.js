import { createManual } from './manual-core.js';

self.onmessage = async ({ data }) => {
  try {
    const result = await createManual({
      name: data?.name,
      themeId: data?.themeId,
      onProgress: progress => self.postMessage({ type: 'progress', progress }),
    });
    self.postMessage({ type: 'complete', buffer: result.bytes.buffer, fileName: result.fileName, pageCount: result.pageCount }, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', code: error?.code || 'generation', userMessage: error?.userMessage || 'PDFを生成できませんでした。通信を確認し、もう一度お試しください。' });
  }
};
