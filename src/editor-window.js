function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}
function editorWindow(starts, length, scrollTop, height, lineHeight) {
  const visible = Math.min(starts.length - 1, Math.max(0, Math.floor((scrollTop - 22) / lineHeight)));
  const first = Math.max(0, visible - 12);
  const last = Math.min(starts.length, visible + Math.ceil(height / lineHeight) + 13);
  return { first, last, start: starts[first], end: starts[last] ?? length };
}
function cursorPosition(starts, offset) {
  let low = 0, high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  const index = Math.max(0, low - 1);
  return { line: index + 1, column: offset - starts[index] + 1 };
}
module.exports = { lineStarts, editorWindow, cursorPosition };
