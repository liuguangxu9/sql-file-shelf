const test = require("node:test");
const assert = require("node:assert/strict");
const { lineStarts, editorWindow, cursorPosition } = require("../src/editor-window");
test("visible window stays bounded and maps exact text offsets", () => {
  const text = Array.from({length:10000}, (_, i) => `SELECT ${i}\n`).join("");
  const starts = lineStarts(text);
  const view = editorWindow(starts, text.length, 22 + 24 * 5000, 480, 24);
  assert.ok(view.last - view.first <= 45);
  assert.equal(view.first, 4988);
  assert.equal(view.start, starts[view.first]);
  assert.equal(view.end, starts[view.last]);
});
test("empty text, final blank line and small viewport have valid bounds", () => {
  assert.deepEqual(lineStarts(""), [0]);
  assert.deepEqual(lineStarts("a\r\nb\n"), [0, 3, 5]);
  assert.deepEqual(editorWindow([0], 0, 0, 480, 24), {first:0,last:1,start:0,end:0});
  const view = editorWindow(lineStarts("a\nb\n"), 4, 9999, 0, 24);
  assert.ok(view.first < view.last);
  assert.equal(view.end, 4);
});

test("cursor position handles blank lines and large offsets without splitting the prefix", () => {
  const starts = lineStarts("SELECT x;\n\n中文");
  assert.deepEqual(cursorPosition(starts, 0), {line:1,column:1});
  assert.deepEqual(cursorPosition(starts, 10), {line:2,column:1});
  assert.deepEqual(cursorPosition(starts, 13), {line:3,column:3});
  const large = Array.from({length:100000},(_,i)=>i*10);
  assert.deepEqual(cursorPosition(large, 900005), {line:90001,column:6});
});
