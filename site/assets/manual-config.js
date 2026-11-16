import { supportedNameRanges } from './manual/name-coverage.js';

export class ManualError extends Error {
  constructor(message, code = 'generation') {
    super(message);
    this.name = 'ManualError';
    this.userMessage = message;
    this.code = code;
  }
}

export const themes = Object.freeze([
  { id: 'pink', label: 'ピンク', accent: '#F715AC', blush: '#F9C6D9', soft: '#FCECF3', line: '#E9E3E7', deep: '#331121', chip: '#25141F' },
  { id: 'blue', label: 'ブルー', accent: '#4169E1', blush: '#BDD0F7', soft: '#EEF3FE', line: '#E0E6F2', deep: '#162446', chip: '#151D31' },
  { id: 'purple', label: 'パープル', accent: '#8B5CF6', blush: '#D9C7FA', soft: '#F4EFFE', line: '#E9E1F3', deep: '#2C1C46', chip: '#21192F' },
  { id: 'green', label: 'グリーン', accent: '#168B72', blush: '#B4DECF', soft: '#EAF6F1', line: '#DDECE5', deep: '#10362D', chip: '#142820' },
  { id: 'coral', label: 'コーラル', accent: '#D96156', blush: '#F4C8BE', soft: '#FCEFEB', line: '#EFE2DD', deep: '#3E211D', chip: '#2C1D19' },
  { id: 'gray', label: 'グレー', accent: '#737783', blush: '#D5D7DE', soft: '#F0F1F4', line: '#E4E5EA', deep: '#272933', chip: '#20222A' },
].map(theme => Object.freeze(theme)));

function hasGlyph(point) {
  let low = 0;
  let high = supportedNameRanges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [first, last] = supportedNameRanges[middle];
    if (point < first) high = middle - 1;
    else if (point > last) low = middle + 1;
    else return true;
  }
  return false;
}

export function validateName(rawName) {
  if (typeof rawName !== 'string') {
    return { valid: false, normalized: '', code: 'invalid-name', message: 'PDFに載せる名称を入力してください。' };
  }
  const normalized = rawName.normalize('NFC').trim();
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(rawName)) {
    return { valid: false, normalized, code: 'invalid-name', message: '改行や見えない制御文字は使えません。名称を1行で入力してください。' };
  }
  if (!normalized) {
    return { valid: false, normalized, code: 'invalid-name', message: 'PDFに載せる名称を入力してください。' };
  }
  if (Array.from(normalized).length > 24) {
    return { valid: false, normalized, code: 'invalid-name', message: '名称は24文字以内で入力してください。' };
  }
  if (Array.from(normalized).some(character => !hasGlyph(character.codePointAt(0)))) {
    return { valid: false, normalized, code: 'unsupported-name', message: '絵文字や一部の文字はPDFに使えません。日本語・英数字などに置き換えてください。' };
  }
  return { valid: true, normalized, message: '' };
}
