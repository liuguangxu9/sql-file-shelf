const test = require('node:test');
const assert = require('node:assert/strict');
const iconv = require('iconv-lite');
const {
  detectEncoding,
  decodeFileBytes,
  encodeForSave,
  normalizeNewlines,
} = require('../src/codec');

test('recognizes and preserves UTF-8 BOM', () => {
  const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('SELECT 中文', 'utf8')]);
  const metadata = detectEncoding(original);
  assert.deepEqual(metadata, { encoding: 'utf-8', bom: 'utf-8', confidence: 1, source: 'bom' });
  const text = decodeFileBytes(original, metadata);
  const saved = encodeForSave(text, metadata);
  assert.deepEqual(saved, original);
});

test('preserves GBK bytes after an edit', () => {
  const original = iconv.encode("SELECT N'医疗类别'", 'gbk');
  const metadata = detectEncoding(original);
  assert.equal(metadata.encoding, 'gbk');
  const saved = encodeForSave("SELECT N'医疗类别' -- 已修改", metadata);
  assert.equal(iconv.decode(saved, 'gbk'), "SELECT N'医疗类别' -- 已修改");
});

test('preserves UTF-16 little-endian BOM', () => {
  const body = iconv.encode('SELECT 1\r\n', 'utf-16le');
  const original = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  const metadata = detectEncoding(original);
  assert.deepEqual(metadata, { encoding: 'utf-16le', bom: 'utf-16le', confidence: 1, source: 'bom' });
  assert.deepEqual(encodeForSave(decodeFileBytes(original, metadata), metadata), original);
});

test('rejects text that cannot be represented by original Windows-1252', () => {
  const metadata = { encoding: 'windows-1252', bom: null, confidence: 0.99, source: 'manual' };
  assert.throws(() => encodeForSave('中文', metadata), /无法用 windows-1252/);
});

test('normalizes new lines only at save time', () => {
  assert.equal(normalizeNewlines('a\nb\r\nc\rd', 'crlf'), 'a\r\nb\r\nc\r\nd');
  assert.equal(normalizeNewlines('a\r\nb', 'lf'), 'a\nb');
});
