const search = require('./search-model');
const { cursorPosition } = require('./editor-window');
const { isWithin, renamedPath } = require('./folder-operations');
const keyOf = (file) => JSON.stringify([file.workspaceId, file.path]);

module.exports = function setupWorkbench(api) {
  const { state, $, get, put, openFile, renderFiles, updateEditorInfo,
    setFileIdentity, renderEditorDecorations, updateFileSelection,
    clearEditor, clearSecondaryCursors, setStatus, scanWorkspace, permission, editorLines } = api;
  const tabs = [];
  const closed = [];
  let recent = [], favorites = [], view = 'files';
  let tabSignature = '', indexSignature = '', fileIndex = [], searchLoading = false;
  let dragging = null;
  const editor = $('editor');
  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const button = (text, action, title = text) => {
    const item = node('button', text);
    item.type = 'button'; item.title = title;
    item.addEventListener('click', action);
    return item;
  };
  const activeTab = () => tabs.find(tab => tab.file === state.active);
  function capture() {
    const tab = activeTab();
    if (!tab) return;
    Object.assign(tab, { text: editor.value, dirty: state.dirty,
      start: editor.selectionStart, end: editor.selectionEnd,
      top: editor.scrollTop, left: editor.scrollLeft, history: state.editorHistory });
  }
  function sync() {
    const tab = activeTab();
    if (tab) tab.dirty = state.dirty;
    renderTabs();
    $('saveState').textContent = state.active ? (state.dirty ? '未保存' : '已保存') : '本地文件 · 离线可用';
    $('saveState').classList.toggle('unsaved', state.dirty);
    $('emptyEditor').hidden = Boolean(state.active);
    if (!state.active) $('findBar').hidden = true;
    $('favoriteFile').disabled = !state.active;
    $('favoriteFile').textContent = state.active && favorites.some(item => keyOf(item) === keyOf(state.active)) ? '★ 已收藏' : '☆ 收藏';
    cursorStatus();
  }
  function renderTabs() {
    const signature = JSON.stringify(tabs.map(tab => [tab.file.workspaceId, state.workspaces.find(w=>w.id===tab.file.workspaceId)?.name, tab.file.path, tab.dirty, tab.file === state.active]));
    if (signature === tabSignature) return;
    tabSignature = signature;
    const fragment = document.createDocumentFragment();
    for (const tab of tabs) {
      const row = node('div', undefined, 'editorTab');
      row.classList.toggle('selected', tab.file === state.active);
      row.setAttribute('role', 'tab');
      row.setAttribute('aria-selected', String(tab.file === state.active));
      const pick = button(`${tab.dirty ? '● ' : ''}${tab.file.name}`, () => activate(tab));
      pick.title = `${state.workspaces.find(w => w.id === tab.file.workspaceId)?.name || ''} / ${tab.file.path}${tab.dirty ? ' · 未保存' : ''}`;
      const close = button('×', () => closeTab(tab), `关闭 ${tab.file.name}`);
      close.className = 'closeTab';
      row.draggable = true;
      row.addEventListener('dragstart', () => { dragging = tab; });
      row.addEventListener('dragover', event => event.preventDefault());
      row.addEventListener('drop', event => {
        event.preventDefault();
        if (!dragging || dragging === tab) return;
        tabs.splice(tabs.indexOf(dragging), 1);
        tabs.splice(tabs.indexOf(tab), 0, dragging);
        dragging = null; renderTabs();
      });
      row.append(pick, close); fragment.append(row);
    }
    if (!tabs.length) fragment.append(node('span', '工作台', 'tabsPlaceholder'));
    $('editorTabs').replaceChildren(fragment);
  }
  function activate(tab) {
    if (tab.file === state.active) return;
    const workspaceChanged = state.activeWorkspaceId !== tab.file.workspaceId;
    capture();
    state.fileOpenVersion++;
    state.active = tab.file;
    state.activeWorkspaceId = tab.file.workspaceId;
    state.dirty = tab.dirty;
    clearSecondaryCursors();
    editor.value = tab.text;
    editor.disabled = false;
    state.editorHistory = tab.history;
    editor.setSelectionRange(tab.start, tab.end);
    renderEditorDecorations();
    editor.scrollTop = tab.top; editor.scrollLeft = tab.left;
    const workspace = state.workspaces.find(w => w.id === tab.file.workspaceId);
    setFileIdentity(tab.file.name, `${workspace?.name || ''} / ${tab.file.path}`);
    updateEditorInfo(); updateFileSelection(); sync();
    if (workspaceChanged) {
      api.render();
      put('activeWorkspaceId', state.activeWorkspaceId);
    }
  }
  function opened() {
    let tab = activeTab();
    if (!tab) { tab = { file: state.active }; tabs.push(tab); }
    capture(); sync();
    const file = { workspaceId: state.active.workspaceId, path: state.active.path, name: state.active.name };
    recent = [file, ...recent.filter(item => keyOf(item) !== keyOf(file))].slice(0, 40);
    put('recentFiles', recent); renderCollection();
  }
  function closeTab(tab) {
    capture();
    if (tab.dirty && !confirm(`“${tab.file.name}”尚未保存。关闭并放弃修改吗？`)) return;
    const index = tabs.indexOf(tab);
    const wasActive = tab.file === state.active;
    tabs.splice(index, 1);
    closed.push({ workspaceId: tab.file.workspaceId, path: tab.file.path });
    if (closed.length > 20) closed.shift();
    if (wasActive) {
      if (tabs.length) activate(tabs[Math.min(index, tabs.length - 1)]);
      else clearEditor();
    }
    sync();
  }
  async function openReference(item) {
    const workspace = state.workspaces.find(w => w.id === item.workspaceId);
    if (!workspace) return setStatus('工作区已移除，请重新添加目录。', true);
    if (!(await permission(workspace.handle))) {
      $('workspaceDialog').showModal();
      return setStatus('请在工作区面板恢复此目录的访问权限。', true);
    }
    let entries = state.fileCache.get(workspace.id) || await scanWorkspace(workspace);
    let entry = entries.find(file => file.path === item.path);
    if (!entry) {
      entries = await scanWorkspace(workspace);
      entry = entries.find(file => file.path === item.path);
    }
    if (!entry) return setStatus('文件已移动或删除，请刷新后重新选择。', true);
    if (await openFile(workspace.id, entry)) {
      if (state.activeWorkspaceId !== workspace.id) {
        state.activeWorkspaceId = workspace.id;
        await put('activeWorkspaceId', workspace.id);
        await api.render();
      }
    }
  }
  function renderCollection() {
    const collection = $('collectionList');
    collection.hidden = view === 'files';
    $('fileList').parentElement.hidden = view !== 'files';
    filePanel.querySelector('.panelHead').hidden = view !== 'files';
    if (view === 'files') return;
    const query = $('fileSearch').value.toLocaleLowerCase();
    const items = (view === 'recent' ? recent : favorites)
      .filter(file => `${file.name} ${file.path}`.toLocaleLowerCase().includes(query));
    collection.replaceChildren();
    for (const item of items) {
      const row = button('', () => openReference(item));
      row.className = 'collectionItem';
      row.append(node('strong', item.name), node('small', `${state.workspaces.find(w => w.id === item.workspaceId)?.name || '已移除工作区'} / ${item.path}`));
      row.title = item.path; collection.append(row);
    }
    if (!items.length) collection.append(node('div', view === 'recent' ? '打开过的文件会显示在这里。' : '在编辑区点击“☆ 收藏”，固定常用脚本。', 'placeholder'));
  }
  function selectView(next) {
    view = next;
    document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    renderCollection();
  }
  function cursorStatus() {
    if (!state.active) { $('cursorStatus').textContent = ''; return; }
    const position = cursorPosition(editorLines(editor.value), editor.selectionStart);
    $('cursorStatus').textContent = `行 ${position.line}，列 ${position.column}`;
  }
  function jump(start, end = start) {
    clearSecondaryCursors();
    editor.focus(); editor.setSelectionRange(start, end);
    const line = editor.value.slice(0, start).split('\n').length - 1;
    editor.scrollTop = Math.max(0, line * parseFloat(getComputedStyle(editor).lineHeight) - editor.clientHeight / 3);
    renderEditorDecorations(); cursorStatus();
  }
  function editText(text, start, end) {
    clearSecondaryCursors();
    editor.value = text; editor.setSelectionRange(start, end);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus(); updateFindCount();
  }
  function findMatches() { return search.matches(editor.value, $('findInput').value, $('matchCase').checked); }
  function updateFindCount() {
    const count = findMatches().length;
    $('findCount').textContent = $('findInput').value ? `${count} 处匹配` : '输入查找内容';
  }
  function findNext(back = false) {
    const found = findMatches(); updateFindCount();
    if (!found.length) return;
    const match = back ? [...found].reverse().find(m => m.start < editor.selectionStart) || found.at(-1)
      : found.find(m => m.start >= editor.selectionEnd && (m.end !== editor.selectionEnd || editor.selectionStart === editor.selectionEnd)) || found[0];
    jump(match.start, match.end);
  }
  function showFind(replace = false) {
    if (!state.active) return setStatus('请先打开文件。');
    $('findBar').hidden = false;
    $('replaceRow').hidden = !replace;
    const selection = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (selection && !selection.includes('\n')) $('findInput').value = selection;
    $('findInput').focus(); $('findInput').select(); updateFindCount();
  }
  function showSearch() {
    $('searchDialog').showModal(); $('globalSearch').focus();
    runSearch();
    if (searchLoading) return;
    const missing = state.workspaces.filter(workspace => !state.fileCache.has(workspace.id));
    if (!missing.length) return;
    searchLoading = true;
    runSearch();
    // Permission and directory reads happen once when opening, never on each search keystroke.
    Promise.allSettled(missing.map(async workspace => {
      if (await permission(workspace.handle)) await scanWorkspace(workspace);
    })).then(() => {
      searchLoading = false;
      if ($('searchDialog').open) runSearch();
    });
  }
  function runSearch() {
    const query = $('globalSearch').value.trim().toLocaleLowerCase();
    const target = $('globalResults'); target.replaceChildren();
    const label = $('searchCount');
    if (!query) {
      label.textContent = searchLoading ? '正在读取其他已授权工作区…' : '按文件名或路径查找 · Enter 打开 · Esc 关闭';
      return;
    }
    const signature = `${state.fileIndexVersion}:${state.workspaces.map(w=>w.id).join(',')}`;
    if (signature !== indexSignature) {
      indexSignature = signature;
      fileIndex = state.workspaces.flatMap(workspace => (state.fileCache.get(workspace.id) || [])
        .map(entry => ({ workspace, entry, term:`${entry.name} ${entry.path}`.toLocaleLowerCase() })));
    }
    let total = 0;
    const fragment = document.createDocumentFragment();
    for (const result of fileIndex) {
      if (!result.term.includes(query)) continue;
      total++;
      if (total > 100) continue;
      const { workspace, entry } = result;
      const item = button('', async () => {
        $('searchDialog').close();
        if (await openFile(workspace.id, entry)) {
          const changed = state.activeWorkspaceId !== workspace.id;
          state.activeWorkspaceId = workspace.id;
          if (changed) { await put('activeWorkspaceId', workspace.id); await api.render(); }
        }
      });
      item.className = 'result';
      item.append(node('strong', entry.name), node('small', `${workspace.name} / ${entry.path}`));
      fragment.append(item);
    }
    target.replaceChildren(fragment);
    const unread = state.workspaces.filter(w=>!state.fileCache.has(w.id)).length;
    label.textContent = `${total > 100 ? `共 ${total} 项，显示前 100 项` : `${total} 项结果`}${searchLoading ? ' · 正在读取其他目录…' : unread ? ` · ${unread} 个工作区未授权，请恢复访问` : ''}`;
    if (!total) target.append(node('div', '没有匹配文件，试试文件名或目录名。', 'placeholder'));
  }

  // Move the existing workspace controls to a compact manager; keep all permission actions intact.
  const layout = document.querySelector('.layout');
  const panels = layout.querySelectorAll(':scope > .panel');
  const workspacePanel = panels[0], filePanel = panels[1];
  filePanel.classList.add('navigation');
  filePanel.id = 'directoryNavigation';
  const manager = $('workspaceDialog');
  manager.append(workspacePanel);
  $('workspaceActions').append($('addWorkspace'));
  $('searchInputHost').append($('globalSearch'));
  $('searchResultsHost').append($('globalResults'));
  workspacePanel.querySelector('.panelHead').style.height = '42px';
  workspacePanel.querySelector('.panelHead').style.flexBasis = '42px';
  const resizers = layout.querySelectorAll('.resizer');
  resizers[0]?.remove();
  filePanel.prepend($('navViews'));
  $('navViews').after($('fileSearch'));
  filePanel.append($('collectionList'));
  document.querySelector('.top-note').hidden = true;
  $('manageWorkspaces').onclick = () => manager.showModal();
  $('closeWorkspaces').onclick = () => manager.close();
  $('closeSearch').onclick = () => $('searchDialog').close();
  $('searchDialog').addEventListener('close', () => { clearTimeout(state.globalTimer); });
  $('quickOpen').onclick = showSearch;
  $('emptyQuickOpen').onclick = showSearch;
  function syncNavigation() {
    const hidden = layout.classList.contains('navigationHidden');
    const toggle = $('toggleNavigation');
    toggle.title = hidden ? '显示左侧目录栏（Ctrl+B）' : '隐藏左侧目录栏（Ctrl+B）';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(!hidden));
    toggle.classList.toggle('collapsed', hidden);
  }
  $('toggleNavigation').onclick = () => {
    layout.classList.toggle('navigationHidden');
    syncNavigation();
    put('navigationHidden', layout.classList.contains('navigationHidden'));
  };
  $('favoriteFile').onclick = () => {
    if (!state.active) return;
    const key = keyOf(state.active);
    if (favorites.some(item => keyOf(item) === key)) favorites = favorites.filter(item => keyOf(item) !== key);
    else favorites.push({ workspaceId: state.active.workspaceId, path: state.active.path, name: state.active.name });
    put('favoriteFiles', favorites); sync(); renderCollection();
  };
  document.querySelectorAll('[data-view]').forEach(item => item.onclick = () => selectView(item.dataset.view));
  $('fileSearch').addEventListener('input', renderCollection);
  $('findFile').onclick = () => showFind();
  $('replaceFile').onclick = () => showFind(true);
  $('closeFind').onclick = () => { $('findBar').hidden = true; editor.focus(); };
  $('findInput').addEventListener('input', updateFindCount);
  $('matchCase').addEventListener('change', updateFindCount);
  $('nextMatch').onclick = () => findNext();
  $('previousMatch').onclick = () => findNext(true);
  $('findInput').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); findNext(event.shiftKey); } });
  $('replaceOne').onclick = () => {
    const hit = findMatches().find(m => m.start === editor.selectionStart && m.end === editor.selectionEnd);
    if (!hit) return findNext();
    const replacement = $('replaceInput').value;
    editText(editor.value.slice(0, hit.start) + replacement + editor.value.slice(hit.end), hit.start, hit.start + replacement.length);
    findNext();
  };
  $('replaceAll').onclick = () => {
    const result = search.replaceAll(editor.value, $('findInput').value, $('replaceInput').value, $('matchCase').checked);
    if (result.count) editText(result.text, 0, 0);
    setStatus(`已替换 ${result.count} 处，可按 Ctrl+Z 撤销。`);
  };
  $('globalSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('globalResults').querySelector('button')?.click(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); $('globalResults').querySelector('button')?.focus(); }
  });
  $('globalResults').addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      (event.key === 'ArrowDown' ? event.target.nextElementSibling : event.target.previousElementSibling)?.focus();
    }
  });
  editor.addEventListener('input', () => { cursorStatus(); if (!$('findBar').hidden) updateFindCount(); });
  editor.addEventListener('keyup', cursorStatus); editor.addEventListener('click', cursorStatus);
  window.addEventListener('keydown', event => {
    if (state.busy) return;
    if (event.key === 'Escape' && !$('findBar').hidden) { $('findBar').hidden = true; editor.focus(); }
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'p') { event.preventDefault(); if (!$('searchDialog').open) showSearch(); }
    if (key === 'b' && !document.querySelector('dialog[open]')) { event.preventDefault(); $('toggleNavigation').click(); }
    if (!event.shiftKey && (key === 'f' || key === 'h')) { event.preventDefault(); showFind(key === 'h'); }
    if (key === 't' && event.shiftKey) { event.preventDefault(); const item = closed.pop(); if (item) openReference(item); }
    if (key === 'tab' && tabs.length > 1) {
      event.preventDefault();
      activate(tabs[(tabs.indexOf(activeTab()) + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length]);
    }
  });
  const ready = Promise.all([get('recentFiles'), get('favoriteFiles'), get('navigationHidden')]).then(([r, f, hidden]) => {
    recent = Array.isArray(r) ? r : []; favorites = Array.isArray(f) ? f : [];
    layout.classList.toggle('navigationHidden', hidden === undefined ? matchMedia('(max-width:650px)').matches : Boolean(hidden)); syncNavigation(); renderCollection(); sync();
  });
  return {
    ready, capture, sync, opened, runSearch,
    cancelSearch() { $('globalResults').replaceChildren(); },
    has(workspaceId, path) { return tabs.some(t => t.file.workspaceId === workspaceId && t.file.path === path); },
    restore(workspaceId, path) {
      const tab = tabs.find(t => t.file.workspaceId === workspaceId && t.file.path === path);
      if (!tab) return false;
      activate(tab); return true;
    },
    discard(workspaceId, path) {
      const index = tabs.findIndex(t => t.file.workspaceId === workspaceId && t.file.path === path);
      if (index >= 0) tabs.splice(index, 1);
      sync();
    },
    dirty(workspaceId, path) {
      capture(); return tabs.some(t => t.dirty && (!workspaceId || t.file.workspaceId === workspaceId) && (!path || t.file.path === path));
    },
    async renameFolder(workspaceId, from, to) {
      capture();
      const entries = state.fileCache.get(workspaceId) || [];
      for (const tab of tabs) {
        if (tab.file.workspaceId !== workspaceId || (from && !isWithin(tab.file.path, from))) continue;
        const path = renamedPath(tab.file.path, from, to);
        const entry = entries.find(item => item.path === path);
        if (!entry) throw new Error(`无法重新定位标签：${path}`);
        Object.assign(tab.file, entry);
      }
      const remap = item => item.workspaceId === workspaceId
        ? { ...item, path:renamedPath(item.path, from, to) } : item;
      recent = recent.map(remap); favorites = favorites.map(remap);
      for (let i=0; i<closed.length; i++) closed[i] = remap(closed[i]);
      await Promise.all([put('recentFiles', recent), put('favoriteFiles', favorites)]);
      if (state.active?.workspaceId === workspaceId) {
        const workspace = state.workspaces.find(item=>item.id === workspaceId);
        setFileIdentity(state.active.name, `${workspace.name} / ${state.active.path}`);
      }
      renderCollection(); sync();
    },
    removeWorkspace(id) {
      for (let index = tabs.length - 1; index >= 0; index--) if (tabs[index].file.workspaceId === id) tabs.splice(index, 1);
      sync();
    },
    refresh() {
      $('manageWorkspaces').textContent = `${state.workspaces.find(w => w.id === state.activeWorkspaceId)?.name || '选择工作区'} ▾`;
      $('manageWorkspaces').title = $('manageWorkspaces').textContent;
      const workspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
      $('workspaceLocation').textContent = workspace ? `当前目录：${workspace.name}${state.selectedFolders.get(workspace.id) ? ' / ' + state.selectedFolders.get(workspace.id) : ''}` : '尚未选择本地目录';
      $('workspaceLocation').title = '浏览器仅提供授权目录名称和相对路径，不暴露完整磁盘路径';
      renderCollection(); sync();
    },
  };
};
