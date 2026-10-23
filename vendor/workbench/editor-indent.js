const INDENT = "\t";

function editIndent(value, start, end, outdent = false) {
  if (!outdent && start === end) {
    return {
      replaceStart: start,
      replaceEnd: end,
      replacement: INDENT,
      selectionStart: start + INDENT.length,
      selectionEnd: start + INDENT.length,
    };
  }

  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lastSelected = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextLine = value.indexOf("\n", lastSelected);
  const lineEnd = nextLine < 0 ? value.length : nextLine;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const changes = [];
  const replacement = lines.map((line) => {
    if (!outdent) {
      changes.push(INDENT.length);
      return INDENT + line;
    }
    const leading = line.match(/^(?:\t| {1,2})/);
    const removed = leading ? leading[0].length : 0;
    changes.push(-removed);
    return line.slice(removed);
  }).join("\n");
  if (changes.every((change) => change === 0)) return null;

  const firstStart = Math.max(lineStart, start + changes[0]);
  const totalChange = changes.reduce((sum, change) => sum + change, 0);
  return {
    replaceStart: lineStart,
    replaceEnd: lineEnd,
    replacement,
    selectionStart: firstStart,
    selectionEnd: end === start ? firstStart : end + totalChange,
  };
}

module.exports = { editIndent };
