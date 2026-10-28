const UI = require("../vendor/workbench/workbench");
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
  let indexSignature = '', searchLoading = false;
  const editor = $('editor');
  const { node, button } = UI;
  const activeTab = () => tabs.find(tab => tab.file === state.active);
  const tabView = UI.createTabs({
    host: $('editorTabs'),
    onSelect(key) { const tab = tabs.find(item => keyOf(item.file) === key); if (tab) activate(tab); },
    onClose(key) { const tab = tabs.find(item => keyOf(item.file) === key); if (tab) closeTab(tab); },
    onReorder(key, index) {
      const from = tabs.findIndex(item => keyOf(item.file) === key);
      if (from < 0) return;
      const [moving] = tabs.splice(from, 1); tabs.splice(index, 0, moving); renderTabs();
      setStatus(`已移动标签：${moving.file.name}（第 ${index + 1} / ${tabs.length} 个）`);
    },
  });
  function capture() {
    const tab = activeTab();
    if (!tab) return;
    Object.assign(tab, { text: editor.value, dirty: state.dirty,
      start: editor.selectionStart, end: editor.selectionEnd,
      top: editor.scrollTop, left: editor.scrollLeft, history: state.editorHistory });
  }
  function updateLocation() {
    const workspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    const path = workspace && state.selectedFolders.get(workspace.id);
    const text = workspace ? `当前目录：${workspace.name}${path ? ' / ' + path : ''}` : '尚未选择本地目录';
    $('workspaceLocation').textContent = text;
    $('workspaceLocation').title = text;
  }
  function selectFileDirectory(file) {
    const slash = file.path.lastIndexOf('/');
    const path = slash < 0 ? '' : file.path.slice(0, slash);
    const changed = (state.selectedFolders.get(file.workspaceId) || '') !== path;
    state.selectedFolders.set(file.workspaceId, path);
    return changed;
  }
  function sync() {
    updateLocation();
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
    tabView.update(tabs.map(tab => ({
      key: keyOf(tab.file), label: tab.file.name, dirty: tab.dirty, selected: tab.file === state.active,
      title: `${state.workspaces.find(w => w.id === tab.file.workspaceId)?.name || ''} / ${tab.file.path}${tab.dirty ? ' · 未保存' : ''} · 双击关闭，拖动排序`,
    })));
  }
  function activate(tab) {
    state.treeFileSelected = true;
    if (tab.file === state.active && state.activeWorkspaceId === tab.file.workspaceId) {
      if (selectFileDirectory(tab.file)) renderFiles();
      updateFileSelection();
      updateLocation();
      setStatus(`已打开 ${tab.file.name}。`);
      return;
    }
    const workspaceChanged = state.activeWorkspaceId !== tab.file.workspaceId;
    const directoryChanged = selectFileDirectory(tab.file);
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
    } else if (directoryChanged) renderFiles();
    setStatus(`已打开 ${tab.file.name}。`);
  }
  function opened(selectDirectory = true) {
    if (selectDirectory && selectFileDirectory(state.active)) renderFiles();
    let tab = activeTab();
    if (!tab) { tab = { file: state.active }; tabs.push(tab); }
    capture(); sync();
    const file = { workspaceId: state.active.workspaceId, path: state.active.path, name: state.active.name };
    recent = [file, ...recent.filter(item => keyOf(item) !== keyOf(file))].slice(0, 40);
    put('recentFiles', recent); renderCollection();
  }
  function closeTab(tab) {
    if (!tabs.includes(tab)) return;
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
    editor.focus();
  }
  const findView = UI.createFindReplace({
    editor, bar: $('findBar'), input: $('findInput'), replacement: $('replaceInput'),
    caseToggle: $('matchCase'), count: $('findCount'), replaceRow: $('replaceRow'),
    buttons: { previous: $('previousMatch'), next: $('nextMatch'), one: $('replaceOne'), all: $('replaceAll'), close: $('closeFind') },
    onEdit: editText, onJump: jump, onFeedback: setStatus,
  });
  function showFind(replace = false) {
    if (!state.active) return setStatus('请先打开文件。');
    findView.show(replace);
  }
  const quickSearch = UI.createQuickOpen({
    dialog: $('searchDialog'), input: $('globalSearch'), results: $('globalResults'), count: $('searchCount'),
    async onSelect(result) {
      const { workspace, entry } = result.record;
      if (await openFile(workspace.id, entry)) {
        const changed = state.activeWorkspaceId !== workspace.id; state.activeWorkspaceId = workspace.id;
        if (changed) { await put('activeWorkspaceId', workspace.id); await api.render(); }
      }
    },
  });
  function showSearch() {
    quickSearch.show();
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
    const signature = `${state.fileIndexVersion}:${state.workspaces.map(w=>w.id).join(',')}`;
    if (signature !== indexSignature) {
      indexSignature = signature;
      quickSearch.setItems(state.workspaces.flatMap(workspace => (state.fileCache.get(workspace.id) || [])
        .map(entry => ({ key: keyOf({ workspaceId: workspace.id, path: entry.path }), label: entry.name,
          description: `${workspace.name} / ${entry.path}`, term: `${entry.name} ${entry.path}`, record: { workspace, entry } }))));
    }
    const unread = state.workspaces.filter(w=>!state.fileCache.has(w.id)).length;
    quickSearch.search({ idleMessage: searchLoading ? '正在读取其他已授权工作区…' : '按文件名或路径查找 · Enter 打开 · Esc 关闭',
      suffix: searchLoading ? ' · 正在读取其他目录…' : unread ? ` · ${unread} 个工作区未授权，请恢复访问` : '' });
  }

  const layout = document.querySelector('.layout');
  const filePanel = $('directoryNavigation');
  const manager = $('workspaceDialog');
  const shell = UI.createShell({
    root: document.querySelector('.app'), layout, navigation: filePanel,
    minNavigationWidth: 280,
    content: document.querySelector('.editorPanel'), toggle: $('toggleNavigation'), splitter: $('navigationSplitter'),
    onChange(value) {
      Promise.all([put('layout', { files: `${value.width}px` }), put('navigationHidden', value.hidden)])
        .catch(error => setStatus(`布局设置未保存：${error.message}`, true));
    },
  });
  const workspaceMenu = $('workspaceMenu');
  function renderWorkspaceMenu() {
    const list = $('workspaceMenuList');
    list.replaceChildren();
    for (const workspace of state.workspaces) {
      const selected = workspace.id === state.activeWorkspaceId;
      const pick = button('', () => {
        workspaceMenu.hidePopover();
        api.requestAccess(workspace.id);
      }, workspace.name);
      pick.className = 'workspaceOption';
      pick.setAttribute('role', 'menuitemradio');
      pick.setAttribute('aria-checked', String(selected));
      pick.append(node('span', workspace.name, 'workspaceOptionName'), node('span', selected ? '✓' : '', 'workspaceCheck'));
      list.append(pick);
    }
    if (!state.workspaces.length) list.append(node('div', '还没有工作区，添加一个本地目录。', 'workspaceMenuEmpty'));
  }
  const workspacePopover = UI.createPopover({ trigger: $('manageWorkspaces'), menu: workspaceMenu, onOpen: renderWorkspaceMenu });
  $('menuAddWorkspace').onclick = () => { workspaceMenu.hidePopover(); $('addWorkspace').click(); };
  $('menuManageWorkspaces').onclick = () => { workspaceMenu.hidePopover(); manager.showModal(); };
  $('closeWorkspaces').onclick = () => manager.close();
  $('closeSearch').onclick = () => $('searchDialog').close();
  $('quickOpen').onclick = showSearch;
  $('emptyQuickOpen').onclick = showSearch;
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
  editor.addEventListener('input', cursorStatus);
  editor.addEventListener('keyup', cursorStatus); editor.addEventListener('click', cursorStatus);
  window.addEventListener('keydown', event => {
    if (state.busy) return;
    if (event.key === 'Escape' && !$('findBar').hidden) { findView.close(); }
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
  const ready = Promise.all([get('recentFiles'), get('favoriteFiles'), get('navigationHidden'), get('layout')]).then(([r, f, hidden, saved]) => {
    recent = Array.isArray(r) ? r : []; favorites = Array.isArray(f) ? f : [];
    shell.restore({ width: saved?.files, hidden }); renderCollection(); sync();
  });
  return {
    ready, capture, sync, opened, runSearch,
    destroy() { tabView.destroy(); workspacePopover.destroy(); shell.destroy(); findView.destroy(); quickSearch.destroy(); },
    cancelSearch() { quickSearch.clear(); },
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
      $('workspaceName').textContent = state.workspaces.find(w => w.id === state.activeWorkspaceId)?.name || '选择工作区';
      $('manageWorkspaces').title = $('workspaceName').textContent;
      if (workspaceMenu.matches(':popover-open')) renderWorkspaceMenu();
      updateLocation();
      renderCollection(); sync();
    },
  };
};
