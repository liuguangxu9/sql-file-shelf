const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, highlightSql } = require("../src/highlight");

test("highlights only requested text while keeping multiline comment context", () => {
  const text = "SELECT 1\n/* comment\nSELECT <&\n*/\nSELECT 2";
  const start = text.indexOf("SELECT <&");
  const end = text.indexOf("\n*/");
  assert.equal(highlightSql(text, { start, end }), '<span class="sql-comment">SELECT &lt;&amp;</span>');
});

test("viewport preserves multiline string context and exact slice", () => {
  const text = "SELECT 'a\nFROM <&\nb' FROM t";
  const start = text.indexOf("FROM <&");
  const end = text.indexOf("\nb'");
  assert.equal(highlightSql(text, { start, end }), '<span class="sql-string">FROM &lt;&amp;</span>');
  assert.equal(highlightSql("a <& b", { start: 2, end: 4 }), "&lt;&amp;");
});

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
