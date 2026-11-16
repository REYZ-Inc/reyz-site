import './vendor/pdf-lib-1.17.1.min.js';
import './vendor/fontkit-1.1.1.umd.min.js';
import { themes, validateName, ManualError } from '../manual-config.js';

const { PDFDocument, PDFName, PDFRef, rgb } = globalThis.PDFLib;
const baseURL = new URL('./', import.meta.url);
const timeoutMilliseconds = 90000;

function assertActive(signal) {
  if (signal?.aborted) throw new DOMException('生成をキャンセルしました。', 'AbortError');
}

async function fetchBytes(relativePath, signal) {
  assertActive(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetch(new URL(relativePath, baseURL), {
      signal: controller.signal,
      credentials: 'same-origin',
      referrerPolicy: 'same-origin',
    });
    if (!response.ok) throw new Error('asset-response');
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    assertActive(signal);
    throw new ManualError('マニュアルのデータを取得できませんでした。通信を確認し、もう一度お試しください。', 'network');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

function colorComponents(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function pdfColor(hex) {
  return colorComponents(hex).map(value => Number(value.toFixed(6))).join(' ');
}

function fileNameFor(name, themeId) {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').trim() || 'manual';
  return `${cleaned}_配信マニュアル_${themeId}.pdf`;
}

function validateLayout(layout) {
  if (layout?.schema !== 1 || layout.pageCount !== 42 || layout.width !== 540 || layout.height !== 960
      || !Array.isArray(layout.streams) || layout.streams.length !== 42
      || !Array.isArray(layout.slots) || layout.slots.length !== 47) {
    throw new ManualError('マニュアルの構成を読み込めませんでした。ページを再読み込みしてください。', 'template');
  }
  for (const slot of layout.slots) {
    if (!Number.isInteger(slot.page) || slot.page < 0 || slot.page >= 42
        || !['x', 'y', 'size', 'maxWidth'].every(key => Number.isFinite(slot[key]))
        || slot.size <= 0 || slot.maxWidth <= 0 || slot.x < 0 || slot.x + slot.maxWidth > 540.1
        || slot.y < 0 || slot.y > 960) {
      throw new ManualError('名称の配置情報を読み込めませんでした。ページを再読み込みしてください。', 'template');
    }
  }
}

export async function createManual({ name, themeId = 'pink', onProgress, signal } = {}) {
  const validation = validateName(name);
  if (!validation.valid) throw new ManualError(validation.message, validation.code);
  const normalized = validation.normalized;
  const theme = themes.find(candidate => candidate.id === themeId);
  if (!theme) throw new ManualError('配色を選び直してください。', 'invalid-name');
  assertActive(signal);
  const progress = (value, label) => onProgress?.({ value, label });
  progress(8, 'マニュアルのデータを準備しています');
  const fontPath = /^[\x20-\x7e]+$/.test(normalized) ? 'fonts/Poppins-Bold.woff' : 'fonts/NotoSansJP-Bold.woff';
  const [template, layoutBytes, fontBytes] = await Promise.all([
    fetchBytes('template.pdf', signal), fetchBytes('layout.json', signal), fetchBytes(fontPath, signal),
  ]);
  assertActive(signal);
  let layout;
  try { layout = JSON.parse(new TextDecoder().decode(layoutBytes)); }
  catch { throw new ManualError('マニュアルの構成を読み込めませんでした。ページを再読み込みしてください。', 'template'); }
  validateLayout(layout);
  progress(35, '名称と配色を反映しています');
  const document = await PDFDocument.load(template, { updateMetadata: false });
  if (document.getPageCount() !== 42) throw new ManualError('マニュアルのページ数が正しくありません。ページを再読み込みしてください。', 'template');
  document.registerFontkit(globalThis.fontkit);
  const font = await document.embedFont(fontBytes, { subset: true });
  const available = new Set(font.getCharacterSet());
  if (Array.from(normalized).some(character => !available.has(character.codePointAt(0)))) {
    throw new ManualError('入力された文字をPDFに表示できません。日本語・英数字などに置き換えてください。', 'unsupported-name');
  }
  const pages = document.getPages();
  const roles = Object.fromEntries(['accent', 'blush', 'soft', 'line', 'deep', 'chip'].map(role => [role, pdfColor(theme[role])]));
  const encoder = new TextEncoder();
  for (let index = 0; index < pages.length; index++) {
    assertActive(signal);
    const page = pages[index];
    const { width, height } = page.getSize();
    if (width !== 540 || height !== 960) throw new ManualError('マニュアルのページサイズが正しくありません。', 'template');
    const reference = page.node.get(PDFName.of('Contents'));
    if (!(reference instanceof PDFRef)) throw new ManualError('マニュアルの描画情報を読み込めませんでした。', 'template');
    if (typeof layout.streams[index] !== 'string') throw new ManualError('マニュアルの描画情報を読み込めませんでした。', 'template');
    const content = layout.streams[index].replace(/\{\{([a-z]+)\}\}/g, (token, role) => {
      if (!(role in roles)) throw new ManualError('配色データを読み込めませんでした。', 'template');
      return roles[role];
    });
    document.context.assign(reference, document.context.flateStream(encoder.encode(content)));
    if (index % 7 === 6) progress(40 + Math.round(index / 42 * 35), `${index + 1} / 42 ページを仕上げています`);
  }
  const unitWidth = font.widthOfTextAtSize(normalized, 1);
  const nameColor = rgb(...colorComponents(theme.accent));
  for (const slot of layout.slots) {
    const size = Math.min(slot.size, slot.maxWidth / Math.max(unitWidth, .01));
    pages[slot.page].drawText(normalized, { x: slot.x, y: slot.y, size, font, color: nameColor });
  }
  document.setTitle(`${normalized} | 配信マニュアル`);
  document.setAuthor(normalized);
  document.setSubject('TikTok LIVE 配信マニュアル | 9:16 スマホ版');
  document.setKeywords(['配信マニュアル', 'TikTok LIVE', theme.label]);
  progress(82, 'ダウンロード用のPDFを作成しています');
  assertActive(signal);
  const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false });
  assertActive(signal);
  progress(100, 'PDFが完成しました');
  return { bytes, fileName: fileNameFor(normalized, theme.id), pageCount: 42 };
}
