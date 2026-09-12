const chardet = require('chardet');
const iconv = require('iconv-lite');

const BOMS = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8', bom: 'utf-8' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le', bom: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be', bom: 'utf-16be' },
];

const ALIASES = new Map([
  ['utf-8', 'utf-8'], ['ascii', 'utf-8'],
  ['utf-16le', 'utf-16le'], ['utf-16be', 'utf-16be'],
  ['gb2312', 'gbk'], ['gbk', 'gbk'], ['gb18030', 'gb18030'], ['cp936', 'gbk'],
  ['windows-1252', 'windows-1252'], ['iso-8859-1', 'windows-1252'],
  ['windows-1251', 'windows-1251'], ['shift_jis', 'shift_jis'],
]);

function hasPrefix(bytes, prefix) {
  return prefix.every((value, index) => bytes[index] === value);
}

function toBuffer(bytes) {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

function strictUtf8(bytes) {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return new TextEncoder().encode(decoded);
  } catch {
    return null;
  }
}

function sameBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeEncoding(label) {
  if (!label) return null;
  return ALIASES.get(label.toLowerCase().replace(/\s/g, '')) || null;
}

function cjkCount(text) {
  return Array.from(text).filter((char) => char >= '\u4e00' && char <= '\u9fff').length;
}

function detectEncoding(raw) {
  const bytes = toBuffer(raw);
  for (const item of BOMS) {
    if (hasPrefix(bytes, item.bytes)) {
      return { encoding: item.encoding, bom: item.bom, confidence: 1, source: 'bom' };
    }
  }

  const utf8 = strictUtf8(bytes);
  if (utf8 && sameBytes(bytes, utf8)) {
    return { encoding: 'utf-8', bom: null, confidence: 1, source: 'strict-utf8' };
  }

  const result = chardet.detect(bytes, {
    detectEncodings: ['GB18030', 'GB2312', 'windows-1252', 'windows-1251', 'Shift_JIS'],
  }) || {};
  // GBK and Windows-1252 are both permissive decoders. For Chinese SQL files,
  // recognizable CJK text is stronger evidence than a single-byte fallback.
  const gbkText = iconv.decode(bytes, 'gbk');
  if (cjkCount(gbkText) >= 2) {
    return { encoding: 'gbk', bom: null, confidence: Math.max(Number(result.confidence || 0), 0.8), source: 'cjk-heuristic' };
  }
  const encoding = normalizeEncoding(result.encoding) || 'windows-1252';
  return {
    encoding,
    bom: null,
    confidence: Number(result.confidence || 0),
    source: result.encoding ? 'heuristic' : 'fallback',
  };
}

function bomLength(metadata) {
  return metadata.bom === 'utf-8' ? 3 : metadata.bom ? 2 : 0;
}

function decodeFileBytes(raw, metadata) {
  return iconv.decode(toBuffer(raw).subarray(bomLength(metadata)), metadata.encoding);
}

function addBom(bytes, bom) {
  if (bom === 'utf-8') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
  if (bom === 'utf-16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), bytes]);
  if (bom === 'utf-16be') return Buffer.concat([Buffer.from([0xfe, 0xff]), bytes]);
  return bytes;
}

function encodeForSave(text, metadata) {
  const encoded = iconv.encode(text, metadata.encoding);
  const roundTrip = iconv.decode(encoded, metadata.encoding);
  if (roundTrip !== text) {
    throw new Error(`无法用 ${metadata.encoding} 无损保存：编辑内容含有该编码无法表示的字符。请另存为 UTF-8。`);
  }
  return addBom(encoded, metadata.bom);
}

function detectNewline(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  const cr = (text.match(/\r(?!\n)/g) || []).length;
  if (crlf >= lf && crlf >= cr && crlf > 0) return 'crlf';
  if (cr > lf && cr > 0) return 'cr';
  return 'lf';
}

function normalizeNewlines(text, style) {
  const newline = style === 'crlf' ? '\r\n' : style === 'cr' ? '\r' : '\n';
  return text.replace(/\r\n|\r|\n/g, '\n').replace(/\n/g, newline);
}

module.exports = {
  detectEncoding,
  decodeFileBytes,
  encodeForSave,
  detectNewline,
  normalizeNewlines,
  normalizeEncoding,
};
