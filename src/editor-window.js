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
module.exports = { lineStarts, editorWindow };
