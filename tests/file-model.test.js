const test = require('node:test');
const assert = require('node:assert/strict');
const { filterFiles, formatFileTime } = require('../src/file-model');

const files = [
  { name: 'notes.md', path: 'docs/notes.md', extension: 'md', modified: 100 },
  { name: 'report.sql', path: 'finance/report.sql', extension: 'sql', modified: 300 },
  { name: 'archive.txt', path: 'archive.txt', extension: 'txt', modified: 200 },
];

test('lists newest files first when no filter is given', () => {
  assert.deepEqual(filterFiles(files, '' ).map((file) => file.name), ['report.sql', 'archive.txt', 'notes.md']);
});

test('matches file name, relative path, and extension without case sensitivity', () => {
  assert.deepEqual(filterFiles(files, 'FINANCE').map((file) => file.name), ['report.sql']);
  assert.deepEqual(filterFiles(files, '.MD').map((file) => file.name), ['notes.md']);
});

test('formats an absent timestamp safely', () => {
  assert.equal(formatFileTime(0), '—');
});
