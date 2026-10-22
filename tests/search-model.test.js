const test = require('node:test');
const assert = require('node:assert/strict');
const { matches, replaceAll, excerpt } = require('../src/search-model');
test('literal SQL search escapes regexp metacharacters and retains source offsets', () => {
  assert.deepEqual(matches('SELECT [a.b] + [A.B]', '[a.b]'), [{start:7,end:12},{start:15,end:20}]);
  assert.deepEqual(matches('İx SELECT 中文', 'select'), [{start:3,end:9}]);
  assert.equal(matches('SELECT select', 'select', true).length, 1);
  assert.deepEqual(matches('abc', ''), []);
});
test('replacement is literal and never recursively replaces inserted text', () => {
  assert.deepEqual(replaceAll('aa aa', 'aa', '$&aa'), {text:'$&aa $&aa', count:2});
  assert.deepEqual(replaceAll('SELECT x', '', 'z'), {text:'SELECT x', count:0});
});
test('search result maps offsets to SQL line and surrounding text', () => {
  assert.deepEqual(excerpt('-- 注释\nSELECT 中文\nFROM x', 9), {line:2,text:'SELECT 中文'});
  assert.deepEqual(excerpt('SELECT', 0), {line:1,text:'SELECT'});
});
