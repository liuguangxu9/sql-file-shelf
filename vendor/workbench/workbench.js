/* Tool Workbench 1.0.1 — dependency-free DOM components. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ToolWorkbench = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0.1';
  function node(tag, text, cls) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  }
  function button(text, action, title = text) {
    const element = node('button', text);
    element.type = 'button'; element.title = title; element.setAttribute('aria-label', title);
    if (action) element.addEventListener('click', action);
    return element;
  }
  function icon(name, cls = '') {
    const paths = {
      folder: ['0 0 20 20', 'M2.5 5.5A1.5 1.5 0 0 1 4 4h3.5l1.7 2H16a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 16 17H4a1.5 1.5 0 0 1-1.5-1.5z'],
      file: ['0 0 16 16', 'M9.5 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9.5 2ZM9 2v4h4'],
      chevron: ['0 0 18 18', 'M6.5 4.5 11.5 9l-5 4.5'],
    };
    if (!paths[name]) throw new Error('Unknown workbench icon');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', paths[name][0]); svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path'); shape.setAttribute('d', paths[name][1]); svg.append(shape); return svg;
  }
  function scope() {
    const cleanups = [];
    return {
      on(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        cleanups.push(() => target.removeEventListener(type, handler, options));
      },
      destroy() { cleanups.splice(0).reverse().forEach(fn => fn()); },
    };
  }
  function clampWidth(value, maximum = 700, minimum = 220) {
    const parsed = Number.parseFloat(value);
    return Math.max(Math.min(minimum, maximum), Math.min(Number.isFinite(parsed) ? parsed : 280, maximum));
  }
  function reorder(items, key, index) {
    const from = items.findIndex(item => item.key === key);
    if (from < 0) return items;
    const next = items.slice(), [moving] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, index)), 0, moving);
    return next;
  }
  function createShell({ root, layout, navigation, content, toggle, splitter, minNavigationWidth = 220, minContentWidth = 300, onChange = () => {} }) {
    const events = scope();
    root.classList.add('wb', 'wb-shell'); layout.classList.add('wb-layout');
    navigation.classList.add('navigation'); content.classList.add('wb-content');
    let drag = null, destroyed = false;
    const minimum = Math.max(160, Number(minNavigationWidth) || 220);
    const maximum = () => Math.max(minimum, Math.min(700, layout.clientWidth - minContentWidth - splitter.getBoundingClientRect().width));
    function width(value, notify = false) {
      const next = clampWidth(value, maximum(), minimum);
      root.style.setProperty('--files-width', `${next}px`);
      splitter.setAttribute('aria-valuenow', String(Math.round(next)));
      splitter.setAttribute('aria-valuemax', String(maximum()));
      if (notify) onChange({ width: next, hidden: layout.classList.contains('navigationHidden') });
    }
    function hidden(value, notify = false) {
      layout.classList.toggle('navigationHidden', Boolean(value));
      toggle.setAttribute('aria-expanded', String(!value));
      toggle.classList.toggle('collapsed', Boolean(value));
      toggle.title = value ? '显示左侧目录栏（Ctrl+B）' : '隐藏左侧目录栏（Ctrl+B）';
      toggle.setAttribute('aria-label', toggle.title);
      if (notify) onChange({ width: Number.parseFloat(root.style.getPropertyValue('--files-width')), hidden: Boolean(value) });
    }
    splitter.classList.add('resizer'); splitter.tabIndex = 0;
    splitter.setAttribute('role', 'separator'); splitter.setAttribute('aria-orientation', 'vertical');
    splitter.setAttribute('aria-valuemin', String(minimum)); splitter.setAttribute('aria-label', '调整目录宽度');
    events.on(toggle, 'click', () => hidden(!layout.classList.contains('navigationHidden'), true));
    events.on(splitter, 'pointerdown', event => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, width: navigation.getBoundingClientRect().width };
      splitter.setPointerCapture(event.pointerId); splitter.classList.add('dragging'); event.preventDefault();
    });
    events.on(splitter, 'pointermove', event => { if (drag) width(drag.width + event.clientX - drag.x); });
    function end(event) {
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.id)) return;
      drag = null; splitter.classList.remove('dragging');
      width(root.style.getPropertyValue('--files-width'), true);
    }
    events.on(splitter, 'pointerup', end); events.on(splitter, 'pointercancel', end); events.on(splitter, 'lostpointercapture', end);
    events.on(splitter, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const now = Number.parseFloat(root.style.getPropertyValue('--files-width'));
      width(event.key === 'Home' ? minimum : event.key === 'End' ? maximum() : now + (event.key === 'ArrowLeft' ? -10 : 10), true);
    });
    events.on(window, 'resize', () => width(root.style.getPropertyValue('--files-width')));
    width(280);
    return { width, hidden, restore(value = {}) { if (!destroyed) { width(value.width); hidden(value.hidden ?? matchMedia('(max-width:650px)').matches); } },
      destroy() { destroyed = true; drag = null; splitter.classList.remove('dragging'); events.destroy(); } };
  }
  function createTabs({ host, onSelect = () => {}, onClose = () => {}, onReorder = () => {}, placeholder = '工作台', closeOnDoubleClick = true }) {
    const events = scope(), rows = new Map();
    host.classList.add('wb-tabs'); host.setAttribute('role', 'tablist'); host.setAttribute('aria-label', '打开的内容');
    let items = [], signature = '', dragging = null, dropIndex = null, dragX = 0, frame = 0;
    const indicator = node('div', undefined, 'tabDropIndicator');
    indicator.hidden = true; indicator.setAttribute('aria-hidden', 'true'); document.body.append(indicator);
    const empty = node('span', placeholder, 'tabsPlaceholder');
    function clearDrop() { dropIndex = null; indicator.hidden = true; cancelAnimationFrame(frame); frame = 0; }
    function finish() { clearDrop(); rows.get(dragging)?.classList.remove('dragging'); host.classList.remove('wb-tab-dragging'); dragging = null; }
    function showDrop(x) {
      const remaining = items.filter(item => item.key !== dragging);
      const before = remaining.findIndex(item => { const box = rows.get(item.key).getBoundingClientRect(); return x < box.left + box.width / 2; });
      dropIndex = before < 0 ? remaining.length : before;
      const bounds = host.getBoundingClientRect(), target = rows.get((remaining[dropIndex] || remaining[remaining.length - 1])?.key);
      const rect = target?.getBoundingClientRect();
      const left = rect ? (dropIndex < remaining.length ? rect.left : rect.right) : bounds.left;
      Object.assign(indicator.style, { left: `${Math.max(bounds.left + 2, Math.min(bounds.right - 3, left)) - 1}px`, top: `${bounds.top + 4}px`, height: `${bounds.height - 8}px` });
      indicator.hidden = false;
    }
    function scroll() {
      frame = 0; if (dragging === null || dropIndex === null) return;
      const box = host.getBoundingClientRect(), step = dragX < box.left + 36 ? -10 : dragX > box.right - 36 ? 10 : 0;
      if (step) { host.scrollLeft += step; showDrop(dragX); frame = requestAnimationFrame(scroll); }
    }
    const record = target => target.closest('.editorTab');
    events.on(host, 'click', event => {
      const row = record(event.target); if (!row || !host.contains(row)) return;
      (event.target.closest('.closeTab') ? onClose : onSelect)(row._key);
    });
    events.on(host, 'dblclick', event => { const row = record(event.target); if (closeOnDoubleClick && row && !event.target.closest('.closeTab')) onClose(row._key); });
    events.on(host, 'keydown', event => {
      const row = record(event.target); if (!row) return;
      const index = items.findIndex(item => item.key === row._key);
      if (event.key === 'Delete') { event.preventDefault(); onClose(row._key); }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + items.length) % items.length;
      onSelect(items[next].key); rows.get(items[next].key)?.firstChild.focus();
    });
    events.on(host, 'dragstart', event => {
      const row = record(event.target); if (!row) return;
      dragging = row._key; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(dragging));
      row.classList.add('dragging'); host.classList.add('wb-tab-dragging');
    });
    events.on(host, 'dragover', event => { if (dragging === null) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; dragX = event.clientX; showDrop(dragX); if (!frame) frame = requestAnimationFrame(scroll); });
    events.on(host, 'dragleave', event => { if (!host.contains(event.relatedTarget)) clearDrop(); });
    events.on(host, 'drop', event => {
      if (dragging === null) return; event.preventDefault(); showDrop(event.clientX);
      const key = dragging, index = dropIndex; finish(); onReorder(key, index);
    });
    events.on(host, 'dragend', finish); events.on(window, 'resize', clearDrop);
    function update(next) {
      if (new Set(next.map(item => item.key)).size !== next.length) throw new Error('Tabs keys must be unique');
      const nextSignature = JSON.stringify(next.map(item => [item.key, item.label, item.title, item.dirty, item.selected]));
      items = next;
      if (nextSignature === signature) return;
      signature = nextSignature;
      const keys = new Set(items.map(item => item.key));
      for (const [key, row] of rows) if (!keys.has(key)) { row.remove(); rows.delete(key); }
      empty.remove();
      items.forEach((item, index) => {
        let row = rows.get(item.key);
        if (!row) { row = node('div', undefined, 'editorTab'); row._key = item.key; row.draggable = true; row.append(button(''), button('×', null, '关闭')); row.lastChild.className = 'closeTab'; rows.set(item.key, row); }
        row.classList.toggle('selected', Boolean(item.selected)); row.setAttribute('role', 'presentation');
        const [pick, close] = row.children;
        pick.setAttribute('role', 'tab'); pick.setAttribute('aria-selected', String(Boolean(item.selected))); pick.tabIndex = item.selected ? 0 : -1;
        pick.textContent = `${item.dirty ? '● ' : ''}${item.label}`; pick.title = item.title || item.label; pick.setAttribute('aria-label', pick.textContent);
        close.title = `关闭 ${item.label}`; close.setAttribute('aria-label', close.title);
        if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
      });
      if (!items.length) host.append(empty);
    }
    return { update, destroy() { finish(); events.destroy(); indicator.remove(); host.replaceChildren(); rows.clear(); } };
  }
  function createTree({ host, onSelect = () => {}, onToggle = () => {}, onAction = () => {} }) {
    const events = scope(), rows = new Map(); let items = [];
    host.classList.add('fileTree'); host.setAttribute('role', 'tree'); host.setAttribute('aria-label', '目录与文件');
    function select(event) {
      const row = event.target.closest('[data-wb-key]'); if (!row || !host.contains(row)) return;
      const item = row._item, action = event.target.closest('[data-action]');
      if (action) { if (!action.disabled) onAction(item, action.dataset.action); return; }
      if (event.target.closest('.treeToggle')) onToggle(item, false);
      else onSelect(item);
    }
    events.on(host, 'click', select);
    events.on(host, 'keydown', event => {
      const row = event.target.closest('[data-wb-key]'); if (!row) return;
      if (event.target.closest('button')) return;
      const index = items.indexOf(row._item);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        for (const element of rows.values()) element.tabIndex = -1;
        const target = rows.get(items[next].key); target.tabIndex = 0; target.focus();
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(row._item); }
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault(); const item = row._item;
        if (item.kind === 'folder' && item.expanded !== (event.key === 'ArrowRight')) onToggle(item, false);
        else if (event.key === 'ArrowLeft') {
          const parent = items.slice(0, index).reverse().find(candidate => candidate.depth < item.depth);
          if (parent) rows.get(parent.key).focus();
        } else if (items[index + 1]?.depth > item.depth) rows.get(items[index + 1].key).focus();
      }
    });
    function update(next) {
      if (new Set(next.map(item => item.key)).size !== next.length) throw new Error('Tree keys must be unique');
      const active = document.activeElement?.closest('[data-wb-key]')?._item?.key;
      items = next; const keys = new Set(items.map(item => item.key));
      for (const [key, row] of rows) if (!keys.has(key)) { row.remove(); rows.delete(key); }
      items.forEach((item, index) => {
        let row = rows.get(item.key);
        if (!row) { row = node('div'); row.dataset.wbKey = String(item.key); rows.set(item.key, row); }
        row._item = item; row.dataset.path = item.path ?? String(item.key);
        row.className = item.kind === 'folder' ? `folderRow${item.expanded ? ' open' : ''}${item.selected ? ' selected' : ''}` : `fileRow${item.depth ? ' nested' : ''}${item.selected ? ' active' : ''}`;
        row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String((item.depth || 0) + 1)); row.setAttribute('aria-selected', String(Boolean(item.selected)));
        if (item.kind === 'folder') row.setAttribute('aria-expanded', String(Boolean(item.expanded))); else row.removeAttribute('aria-expanded');
        row.tabIndex = active !== undefined ? (item.key === active ? 0 : -1) : index === 0 ? 0 : -1;
        row.title = item.title || item.label;
        const signature = JSON.stringify([item.kind, item.label, item.meta, item.depth, item.expanded, item.badges, item.actions]);
        if (row._signature !== signature) {
          row._signature = signature;
          const cell = node('div', undefined, item.kind === 'folder' ? 'treeNameCell' : 'fileNameCell');
          cell.style.paddingLeft = `${(item.depth || 0) * 20 + (item.kind === 'folder' ? 0 : 22)}px`;
          if (item.kind === 'folder') {
            const arrow = button('', null, item.expanded ? '收起目录' : '展开目录'); arrow.append(icon('chevron')); arrow.className = 'treeToggle'; arrow.setAttribute('aria-expanded', String(Boolean(item.expanded)));
            const pick = button(item.label, null, item.title || item.label); pick.className = 'folderPick folderName'; cell.append(arrow, icon('folder', 'folderIcon'), pick);
          } else cell.append(icon('file', 'fileIcon'), node('span', item.label, 'fileNameText'));
          if (item.badges?.length) {
            const badges = node('span', undefined, 'folderCounts');
            for (const badge of item.badges) { const value = node('span', undefined, 'folderCount'); if (badge.icon) value.append(icon(badge.icon)); value.append(document.createTextNode(badge.text)); value.title = badge.title || badge.text; badges.append(value); }
            cell.append(badges);
          }
          const actions = node('div', undefined, item.kind === 'folder' ? 'folderActions' : 'fileRowActions');
          for (const action of item.actions || []) { const control = button(action.label, null, action.title); control.className = action.danger ? 'fileDelete' : 'fileAction'; if (item.kind === 'folder') control.classList.add(action.id === 'rename' ? 'folderRename' : 'folderDelete'); control.dataset.action = action.id; control.disabled = Boolean(action.disabled); actions.append(control); }
          if (item.kind === 'folder') cell.append(actions);
          row.replaceChildren(cell);
          if (item.meta) { const meta = node('div', item.meta, 'fileMeta'); meta.style.paddingLeft = `${(item.depth || 0) * 20 + 40}px`; row.append(meta); }
          if (item.kind !== 'folder') row.append(actions);
        }
        if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
      });
    }
    return { update,
      setSelected(predicate) {
        for (const item of items) {
          const selected = Boolean(predicate(item));
          item.selected = selected;
          const row = rows.get(item.key);
          row.classList.toggle(item.kind === 'folder' ? 'selected' : 'active', selected);
          row.setAttribute('aria-selected', String(selected));
        }
      },
      destroy() { events.destroy(); host.replaceChildren(); rows.clear(); } };
  }
  function createPopover({ trigger, menu, onOpen = () => {} }) {
    const events = scope(); menu.classList.add('wb', 'wb-popover');
    menu.setAttribute('popover', 'auto'); trigger.setAttribute('popovertarget', menu.id); trigger.setAttribute('aria-haspopup', 'menu');
    function position() {
      if (!menu.matches(':popover-open')) return;
      const box = trigger.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, box.left))}px`;
      menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, box.bottom + 8))}px`;
    }
    events.on(menu, 'beforetoggle', event => { trigger.setAttribute('aria-expanded', String(event.newState === 'open')); if (event.newState === 'open') onOpen(); });
    events.on(menu, 'toggle', event => { if (event.newState === 'open') { position(); (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button:not(:disabled)'))?.focus(); } });
    events.on(trigger, 'keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); menu.showPopover(); } });
    events.on(menu, 'keydown', event => {
      const items = [...menu.querySelectorAll('button:not(:disabled)')]; const index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next]?.focus();
      }
      if (event.key === 'Escape') { menu.hidePopover(); trigger.focus(); }
    });
    events.on(window, 'resize', position); events.on(window, 'scroll', position, true);
    return { position, close() { menu.hidePopover(); }, destroy() { if (menu.matches(':popover-open')) menu.hidePopover(); events.destroy(); trigger.setAttribute('aria-expanded', 'false'); } };
  }
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

  function createQuickOpen({ dialog, input, results, count, onSelect, limit = 100, delay = 120 }) {
    const events = scope(); let items = [], timer = 0, hint = {};
    function setItems(next) { items = next.map(item => ({ ...item, term: (item.term ?? `${item.label} ${item.description || ''}`).toLocaleLowerCase() })); }
    function search(options = hint) {
      hint = options; clearTimeout(timer);
      const query = input.value.trim().toLocaleLowerCase(), fragment = document.createDocumentFragment(); let total = 0;
      if (!query) { results.replaceChildren(); count.textContent = options.idleMessage || '输入名称或路径 · Enter 打开 · Esc 关闭'; return; }
      for (const item of items) {
        if (!item.term.includes(query)) continue;
        if (++total > limit) continue;
        const row = button('', null, item.description || item.label); row.className = 'result'; row._item = item;
        row.append(node('strong', item.label), node('small', item.description || '')); fragment.append(row);
      }
      if (!total) fragment.append(node('div', '没有匹配项。', 'placeholder'));
      results.replaceChildren(fragment);
      count.textContent = `${total > limit ? `共 ${total} 项，显示前 ${limit} 项` : `${total} 项结果`}${options.suffix || ''}`;
    }
    function choose(item) { if (!item) return; dialog.close(); onSelect(item); }
    events.on(input, 'input', () => { clearTimeout(timer); results.replaceChildren(); timer = setTimeout(() => search(), delay); });
    events.on(input, 'keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); choose(results.querySelector('button')?._item); }
      if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('button')?.focus(); }
    });
    events.on(results, 'click', event => { const row = event.target.closest('button'); if (row && results.contains(row)) choose(row._item); });
    events.on(results, 'keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); (event.key === 'ArrowDown' ? event.target.nextElementSibling : event.target.previousElementSibling)?.focus(); }
    });
    events.on(dialog, 'close', () => clearTimeout(timer));
    return { setItems, search, show() { if (!dialog.open) dialog.showModal(); input.focus(); search(); }, clear() { clearTimeout(timer); results.replaceChildren(); }, destroy() { clearTimeout(timer); events.destroy(); results.replaceChildren(); } };
  }
  function createFindReplace({ editor, bar, input, replacement, caseToggle, count, replaceRow, buttons, onEdit, onJump, onFeedback = () => {} }) {
    const events = scope(); let cached = null;
    function found() {
      const signature = [editor.value, input.value, caseToggle.checked];
      if (!cached || signature.some((value, index) => value !== cached.signature[index])) cached = { signature, hits: matches(...signature) };
      return cached.hits;
    }
    function updateCount() { count.textContent = input.value ? `${found().length} 处匹配` : '输入查找内容'; }
    function next(back = false) {
      const hits = found(); updateCount(); if (!hits.length) return;
      const hit = back ? [...hits].reverse().find(item => item.start < editor.selectionStart) || hits.at(-1)
        : hits.find(item => item.start >= editor.selectionEnd && (item.end !== editor.selectionEnd || editor.selectionStart === editor.selectionEnd)) || hits[0];
      if (onJump) onJump(hit.start, hit.end); else { editor.focus(); editor.setSelectionRange(hit.start, hit.end); }
    }
    function edit(text, start, end) {
      if (onEdit) onEdit(text, start, end);
      else { editor.value = text; editor.setSelectionRange(start, end); editor.dispatchEvent(new Event('input', { bubbles: true })); editor.focus(); }
      updateCount();
    }
    function close() { bar.hidden = true; editor.focus(); }
    events.on(bar, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
    events.on(input, 'input', updateCount); events.on(caseToggle, 'change', updateCount);
    events.on(editor, 'input', () => { if (!bar.hidden) updateCount(); });
    events.on(input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); next(event.shiftKey); } });
    events.on(buttons.previous, 'click', () => next(true)); events.on(buttons.next, 'click', () => next()); events.on(buttons.close, 'click', close);
    events.on(buttons.one, 'click', () => {
      const hit = found().find(item => item.start === editor.selectionStart && item.end === editor.selectionEnd);
      if (!hit) return next();
      edit(editor.value.slice(0, hit.start) + replacement.value + editor.value.slice(hit.end), hit.start, hit.start + replacement.value.length); next();
    });
    events.on(buttons.all, 'click', () => { const result = replaceAll(editor.value, input.value, replacement.value, caseToggle.checked); if (result.count) edit(result.text, 0, 0); onFeedback(`已替换 ${result.count} 处，可按 Ctrl+Z 撤销。`); });
    return { updateCount, next, close, show(replace = false) {
      if (editor.disabled) return; bar.hidden = false; replaceRow.hidden = !replace;
      const selection = editor.value.slice(editor.selectionStart, editor.selectionEnd); if (selection && !selection.includes('\n')) input.value = selection;
      input.focus(); input.select(); updateCount();
    }, destroy() { events.destroy(); cached = null; } };
  }
  function lineStarts(text) { const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1); return starts; }
  function editorWindow(starts, length, scrollTop, height, lineHeight) {
    const visible = Math.min(starts.length - 1, Math.max(0, Math.floor((scrollTop - 22) / lineHeight)));
    const first = Math.max(0, visible - 12), last = Math.min(starts.length, visible + Math.ceil(height / lineHeight) + 13);
    return { first, last, start: starts[first], end: starts[last] ?? length };
  }
  function cursorPosition(starts, offset) {
    let low = 0, high = starts.length;
    while (low < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle + 1; else high = middle; }
    const index = Math.max(0, low - 1); return { line: index + 1, column: offset - starts[index] + 1 };
  }
  function createEditorSurface({ editor, ids = {}, decorate, onScroll = () => {}, maxDecoratedChars = 180000, getLines = lineStarts }) {
    const events = scope(), shell = node('div', undefined, 'editorShell'), lines = node('pre', undefined, 'lineNumbers'), numbers = node('div'), highlight = node('pre', undefined, 'highlight'), code = node('code'), cursors = node('div', undefined, 'secondaryCursors');
    for (const [name, element] of Object.entries({ lines, numbers, highlight, code, cursors })) { if (ids[name]) element.id = ids[name]; element.setAttribute('aria-hidden', 'true'); }
    editor.before(shell); lines.append(numbers); highlight.append(code); shell.append(lines, highlight, editor, cursors);
    let cache = null, frame = 0, destroyed = false;
    function render(force = false) {
      if (destroyed) return;
      const text = editor.value, plain = text.length > maxDecoratedChars;
      shell.classList.toggle('plainEditor', plain);
      if (plain) { code.textContent = ''; numbers.textContent = ''; cache = null; return; }
      if (!cache || cache.text !== text) cache = { text, starts: getLines(text) };
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
      const view = editorWindow(cache.starts, text.length, editor.scrollTop, editor.clientHeight, lineHeight);
      if (force || cache.first !== view.first || cache.last !== view.last) {
        if (decorate) { const fragment = decorate(text, view); code.replaceChildren(fragment); }
        else code.textContent = text.slice(view.start, view.end);
        numbers.textContent = Array.from({ length: view.last - view.first }, (_, i) => view.first + i + 1).join('\n');
        cache.first = view.first; cache.last = view.last;
      }
      const y = view.first * lineHeight - editor.scrollTop;
      code.style.transform = `translate(${-editor.scrollLeft}px, ${y}px)`; numbers.style.transform = `translateY(${y}px)`;
    }
    function refresh() { cancelAnimationFrame(frame); frame = 0; render(true); }
    function schedule() { if (!destroyed && !frame) frame = requestAnimationFrame(() => { frame = 0; render(true); }); }
    events.on(editor, 'scroll', () => { render(); onScroll(); }); events.on(editor, 'input', schedule);
    const observer = new ResizeObserver(() => { render(); onScroll(); }); observer.observe(editor); render(true);
    return { shell, cursors, render, refresh, schedule, destroy() { destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); events.destroy(); shell.before(editor); shell.remove(); } };
  }
  return { VERSION, node, button, icon, clampWidth, reorder, createShell, createTabs, createTree, createPopover, createEditorSurface, createQuickOpen, createFindReplace, search: { matches, replaceAll, excerpt }, lineStarts, editorWindow, cursorPosition };
});
