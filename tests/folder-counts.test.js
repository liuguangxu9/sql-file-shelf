const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFileTree } = require('../src/file-model');
test('directory counts are direct children and independent of search and expansion', () => {
  const folders = ['', 'a', 'a/nested', 'empty'].map(path => ({path}));
  const entries = ['a/one.sql', 'a/two.md', 'a/nested/three.sql'].map(path => ({path, name:path.split('/').pop(), extension:path.split('.').pop()}));
  const collapsed = buildFileTree(folders, entries, {hideRoot:true, expanded:[]});
  assert.deepEqual(collapsed.rows.find(r => r.path==='a').counts, {folders:1, files:2});
  assert.deepEqual(collapsed.rows.find(r => r.path==='empty').counts, {folders:0, files:0});
  const searched = buildFileTree(folders, entries, {query:'one', hideRoot:true});
  assert.deepEqual(searched.rows.find(r => r.path==='a').counts, {folders:1, files:2});
  const expanded = buildFileTree(folders, entries, {hideRoot:true, expanded:['a']});
  assert.deepEqual(expanded.rows.find(r => r.path==='a/nested').counts, {folders:0, files:1});
});
