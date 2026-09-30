function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const TOKENS =
  /(--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:''|[^'])*(?:'|$)|"(?:""|[^"])*(?:"|$))|\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|INSERT|INTO|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|VIEW|AS|AND|OR|NOT|NULL|IS|IN|LIKE|ORDER|BY|GROUP|HAVING|LIMIT|CASE|WHEN|THEN|ELSE|END|VALUES|SET|DISTINCT|UNION|ALL)\b|\b(\d+(?:\.\d+)?)\b/gi;

function highlightSql(text, { start = 0, end: limit = text.length } = {}) {
  let result = "";
  let end = 0;
  for (const match of String(text).matchAll(TOKENS)) {
    if (match.index >= limit) break;
    if (match.index + match[0].length <= start) {
      end = match.index + match[0].length;
      continue;
    }
    result += escapeHtml(text.slice(Math.max(start, end), Math.min(limit, match.index)));
    const style = match[1]
      ? "sql-comment"
      : match[2]
        ? "sql-string"
        : match[3]
          ? "sql-keyword"
          : "sql-number";
    result += `<span class="${style}">${escapeHtml(text.slice(Math.max(start, match.index), Math.min(limit, match.index + match[0].length)))}</span>`;
    end = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(Math.max(start, end), limit));
}

module.exports = { escapeHtml, highlightSql };
