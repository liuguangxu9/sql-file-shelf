// Evaluate in an isolated browser fixture after opening at least three tabs.
// Exercises UI events only; never writes files or touches user directories.
(async () => {
  const bar = document.getElementById('editorTabs');
  const rows = () => [...bar.querySelectorAll('.editorTab')];
  const checks = [];
  const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const original = rows();
  assert(original.length >= 3, 'fixture has at least three tabs');
  const selected = bar.querySelector('.selected');
  const editor = document.getElementById('editor');
  const draft = editor.value;
  const transfer = new DataTransfer();
  const fire = (target, type, x) => target.dispatchEvent(new DragEvent(type, {
    bubbles: true, cancelable: true, dataTransfer: transfer,
    clientX: x, clientY: bar.getBoundingClientRect().top + 18,
  }));
  const indicator = document.querySelector('.tabDropIndicator');
  const first = original[0], last = original[original.length - 1];
  fire(first, 'dragstart', first.getBoundingClientRect().left + 20);
  await new Promise(requestAnimationFrame);
  assert(first.classList.contains('dragging'), 'drag source visibly fades');
  const endX = last.getBoundingClientRect().right + 15;
  fire(bar, 'dragover', endX);
  assert(!indicator.hidden, 'insertion marker appears in trailing blank space');
  assert(Math.abs(parseFloat(indicator.style.left) + 1 - last.getBoundingClientRect().right) < 2,
    'marker shows exact end position');
  fire(bar, 'drop', endX);
  assert(rows().at(-1) === first, 'drop in trailing blank space appends tab');
  assert(indicator.hidden && !first.classList.contains('dragging'), 'drop clears feedback');
  assert(bar.querySelector('.selected') === selected && editor.value === draft,
    'reordering preserves active tab and draft');
  const startX = rows()[0].getBoundingClientRect().left + 2;
  fire(first, 'dragstart', endX);
  fire(bar, 'dragover', startX);
  fire(bar, 'drop', startX);
  assert(rows().every((row, index) => row === original[index]), 'leftward drop restores order');
  const target = rows()[1], rect = target.getBoundingClientRect();
  fire(first, 'dragstart', startX);
  fire(target, 'dragover', rect.right - 2);
  fire(target, 'drop', rect.right - 2);
  assert(rows()[1] === first, 'right half inserts after target');
  fire(first, 'dragstart', startX);
  fire(bar, 'dragover', startX);
  fire(first, 'dragend', startX);
  assert(indicator.hidden && rows()[1] === first, 'cancelled drag preserves order and clears marker');
  fire(bar, 'dragover', startX);
  assert(indicator.hidden, 'external drag is ignored');
  const pick = first.querySelector('button');
  pick.click();
  editor.value += '\n-- tab-close test draft';
  editor.dispatchEvent(new Event('input', {bubbles: true}));
  const unsaved = editor.value, originalConfirm = window.confirm;
  let confirmations = 0;
  try {
    window.confirm = () => { confirmations++; return false; };
    pick.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}));
    assert(rows().includes(first) && editor.value === unsaved && confirmations === 1,
      'cancelled double-click close retains unsaved tab and draft');
    window.confirm = () => { confirmations++; return true; };
    pick.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}));
    assert(!rows().includes(first) && confirmations === 2, 'confirmed double-click closes unsaved tab');
    const next = rows()[0];
    next.querySelector('button').click();
    assert(bar.querySelector('.selected') === next, 'single-click retains tab node when activating');
    next.querySelector('button').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
    assert(!rows().includes(next), 'double-click closes saved tab');
  } finally { window.confirm = originalConfirm; }
  return {passed: checks.length, checks};
})()
