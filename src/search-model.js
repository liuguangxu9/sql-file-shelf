function matches(text, query, sensitive = false, limit = Infinity) {
  if (!query) return [];
  // Use escaped Unicode regexp so offsets always refer to the original text.
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const result = [];
  for (const match of text.matchAll(new RegExp(pattern, sensitive ? "gu" : "giu"))) {
    result.push({ start: match.index, end: match.index + match[0].length });
    if (result.length >= limit) break;
  }
  return result;
}
function replaceAll(text, query, replacement, sensitive = false) {
  const found = matches(text, query, sensitive);
  for (let index = found.length - 1; index >= 0; index--) {
    const match = found[index];
    text = text.slice(0, match.start) + replacement + text.slice(match.end);
  }
  return { text, count: found.length };
}
function excerpt(text, position) {
  const start = text.lastIndexOf("\n", position - 1) + 1;
  const end = text.indexOf("\n", position);
  return { line: text.slice(0, position).split("\n").length,
    text: text.slice(start, end < 0 ? text.length : end).trim().slice(0, 220) };
}
module.exports = { matches, replaceAll, excerpt };
