const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, highlightSql } = require("../src/highlight");

test("escapes SQL operators and ampersands outside highlighted tokens", () => {
  const output = highlightSql("SELECT a<value & b>c FROM t;");
  assert.match(output, /<span class="sql-keyword">SELECT<\/span>/);
  assert.match(output, /a&lt;value &amp; b&gt;c/);
  assert.equal(output.includes("<value"), false);
});

test("preserves special characters inside SQL strings and comments", () => {
  const output = highlightSql("SELECT '<tag>&' -- <note>&\nFROM t");
  assert.match(output, /<span class="sql-string">'&lt;tag&gt;&amp;'<\/span>/);
  assert.match(output, /<span class="sql-comment">-- &lt;note&gt;&amp;<\/span>/);
  assert.match(output, /\n<span class="sql-keyword">FROM<\/span>/);
  assert.equal(escapeHtml("<&>"), "&lt;&amp;&gt;");
});
