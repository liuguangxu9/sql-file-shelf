const test = require("node:test");
const assert = require("node:assert/strict");
const { editIndent } = require("../src/editor-indent");

function apply(value, start, end, outdent) {
  const change = editIndent(value, start, end, outdent);
  return change && {
    value: value.slice(0, change.replaceStart) + change.replacement + value.slice(change.replaceEnd),
    start: change.selectionStart,
    end: change.selectionEnd,
  };
}

test("Tab inserts a real tab character at the caret", () => {
  assert.deepEqual(apply("SELECT 1", 7, 7), { value: "SELECT \t1", start: 8, end: 8 });
});

test("Tab indents selected lines but excludes an unselected following line", () => {
  assert.deepEqual(apply("one\ntwo\nthree", 0, 8), {
    value: "\tone\n\ttwo\nthree", start: 1, end: 10,
  });
});

test("Shift+Tab outdents selected lines and keeps the selection", () => {
  assert.deepEqual(apply("  one\n\ttwo\nthree", 2, 10, true), {
    value: "one\ntwo\nthree", start: 0, end: 7,
  });
});

test("Shift+Tab at the caret outdents its line without moving before line start", () => {
  assert.deepEqual(apply("a\n  two", 2, 2, true), {
    value: "a\ntwo", start: 2, end: 2,
  });
  assert.equal(apply("one", 1, 1, true), null);
});
