// Isolated browser fixture only. Stress collection rows without user-directory access.
(async () => {
  const $ = id => document.getElementById(id), checks = [];
  const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const pause = () => new Promise(requestAnimationFrame);
  if ($('toggleNavigation').getAttribute('aria-expanded') === 'false') $('toggleNavigation').click();
  document.querySelector('[data-view="recent"]').click();
  if ($('collectionList').children.length < 120) {
    $('collectionList').replaceChildren(...Array.from({ length: 180 }, (_, i) => {
      const row = document.createElement('button'); row.className = 'collectionItem';
      row.textContent = `门诊住院诊疗项目发生制-${i}.sql`; return row;
    }));
  }
  await pause();
  const search = $('fileSearch').getBoundingClientRect();
  assert(search.height === 32, '180 collection rows do not squeeze the search frame');
  assert($('navViews').getBoundingClientRect().height >= 50, 'navigation buttons retain their full height');
  const collection = $('collectionList').getBoundingClientRect();
  assert(collection.top >= search.bottom && collection.bottom <= $('directoryNavigation').getBoundingClientRect().bottom + 1, 'only the collection viewport shrinks and scrolls');
  const bar = $('navigationSplitter');
  bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert(Number(bar.getAttribute('aria-valuemin')) === 280 && Number(bar.getAttribute('aria-valuenow')) === 280, 'sidebar Home respects the application minimum');
  assert($('directoryNavigation').getBoundingClientRect().width >= 280, 'sidebar cannot collapse below usable toolbar width');
  document.querySelector('[data-view="files"]').click();
  const previousCount = $('fileCount').textContent; $('fileCount').textContent = '123456789 个文件';
  await pause();
  const panel = $('directoryNavigation').getBoundingClientRect(), header = $('directoryNavigation').querySelector('.panelHead').getBoundingClientRect();
  const controls = [...$('directoryNavigation').querySelectorAll('.panelActions button'), $('fileCount')];
  assert(controls.every(element => { const box = element.getBoundingClientRect(); return box.left >= panel.left && box.right <= panel.right && box.top >= header.top && box.bottom <= header.bottom; }), 'toolbar wraps inside its panel instead of being covered');
  $('fileCount').textContent = previousCount;
  const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 20)); } throw Error('fixture timeout'); };
  for (const name of ['医嘱查询.sql', '费用核对.sql']) {
    document.querySelector(`.fileRow[data-path="${name}"]`).click(); await wait(() => $('fileTitle').textContent === name);
  }
  const row = $('editorTabs').querySelector('.editorTab'), pick = row.firstElementChild;
  assert(getComputedStyle(row).cursor === 'default' && getComputedStyle(pick).cursor === 'default', 'hovering a tab uses the normal arrow');
  assert(getComputedStyle(row.lastElementChild).cursor === 'pointer', 'tab close keeps its action cursor');
  const transfer = new DataTransfer();
  row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
  assert(getComputedStyle(pick).cursor === 'grabbing', 'grab cursor begins only when dragging starts');
  row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  assert(getComputedStyle(pick).cursor === 'default' && !$('editorTabs').classList.contains('wb-tab-dragging'), 'ending or cancelling drag restores the arrow');
  return { passed: checks.length, checks };
})()
