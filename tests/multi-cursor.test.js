const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMultiEdit } = require("../src/multi-cursor");

test("typing and pasting insert at every cursor in one edit", () => {
  assert.deepEqual(applyMultiEdit("a\nb", [0, 2], "insert", "X"), {
    value: "Xa\nXb", positions: [1, 4],
  });
  assert.deepEqual(applyMultiEdit("a\nb", [1, 3], "insert", " = 1"), {
    value: "a = 1\nb = 1", positions: [5, 11],
  });
});

test("backspace and Delete work across cursors", () => {
  assert.deepEqual(applyMultiEdit("ab\ncd", [2, 5], "backspace"), {
    value: "a\nc", positions: [1, 3],
  });
  assert.deepEqual(applyMultiEdit("ab\ncd", [0, 3], "delete"), {
    value: "b\nd", positions: [0, 2],
  });
});

test("duplicate and adjacent cursors do not repeat a removal", () => {
  assert.deepEqual(applyMultiEdit("ab", [1, 1, 2], "backspace"), {
    value: "", positions: [0, 0, 0],
  });
});

test("Shift+Tab removes indentation once per line", () => {
  assert.deepEqual(applyMultiEdit("\ta\n  b", [1, 2, 6], "outdent"), {
    value: "a\nb", positions: [0, 1, 3],
  });
});

test("deletion keeps surrogate pairs intact", () => {
  assert.deepEqual(applyMultiEdit("😀x", [2], "backspace"), {
    value: "x", positions: [0],
  });
});
