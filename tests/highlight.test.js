const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, highlightSql } = require("../src/highlight");

test("unterminated comments and strings remain one escaped token", () => {
  assert.equal(highlightSql("/* unfinished <& SELECT"), '<span class="sql-comment">/* unfinished &lt;&amp; SELECT</span>');
  assert.equal(highlightSql("'unfinished <& SELECT"), '<span class="sql-string">\'unfinished &lt;&amp; SELECT</span>');
});

test("unfinished repeated comment openers have bounded processing time", () => {
  const text = "/* a ".repeat(30000);
  const start = performance.now();
  const result = highlightSql(text);
  assert.ok(performance.now() - start < 250, "highlighter must scan once rather than retry every opener");
  assert.equal(result, `<span class="sql-comment">${text}</span>`);
});

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
