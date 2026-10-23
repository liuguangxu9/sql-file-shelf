function previousCharacterStart(value, position) {
  if (position === 0) return 0;
  const previous = value.charCodeAt(position - 1);
  return previous >= 0xdc00 && previous <= 0xdfff && position > 1
    ? position - 2 : position - 1;
}

function nextCharacterEnd(value, position) {
  if (position >= value.length) return value.length;
  const current = value.charCodeAt(position);
  return current >= 0xd800 && current <= 0xdbff ? position + 2 : position + 1;
}

function applyMultiEdit(value, positions, action, text = "") {
  const unique = [...new Set(positions)].sort((a, b) => a - b);
  const edits = [];
  for (const position of unique) {
    if (action === "insert") {
      if (text) edits.push({ start: position, end: position, text });
    } else if (action === "backspace") {
      const start = previousCharacterStart(value, position);
      if (start < position) edits.push({ start, end: position, text: "" });
    } else if (action === "delete") {
      const end = nextCharacterEnd(value, position);
      if (end > position) edits.push({ start: position, end, text: "" });
    } else if (action === "outdent") {
      const start = value.lastIndexOf("\n", position - 1) + 1;
      const leading = value.slice(start).match(/^(?:\t| {1,2})/);
      if (leading && !edits.some((edit) => edit.start === start))
        edits.push({ start, end: start + leading[0].length, text: "" });
    }
  }
  if (!edits.length) return null;
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const edit of edits) {
    const last = merged[merged.length - 1];
    if (last && edit.start < last.end) {
      last.end = Math.max(last.end, edit.end);
    } else merged.push({ ...edit });
  }
  let output = "";
  let consumed = 0;
  for (const edit of merged) {
    output += value.slice(consumed, edit.start) + edit.text;
    consumed = edit.end;
  }
  output += value.slice(consumed);
  const updatedPositions = positions.map((position) => {
    let shift = 0;
    for (const edit of merged) {
      if (position < edit.start) break;
      if (position <= edit.end)
        return edit.start + shift + edit.text.length;
      shift += edit.text.length - (edit.end - edit.start);
    }
    return position + shift;
  });
  return { value: output, positions: updatedPositions };
}

module.exports = { applyMultiEdit };
