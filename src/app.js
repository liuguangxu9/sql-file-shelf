const codec = require('./codec');
const store = require('./workspace-store');
const files = require('./file-model');
const ACCEPTED = new Set(['sql', 'txt', 'md']);
const state = { workspaces: [], activeWorkspaceId: null, fileCache: new Map(), active: null, dirty: false, globalTimer: null };
const $ = (id) => document.getElementById(id);
const current = () => state.workspaces.find((item) => item.id === state.activeWorkspaceId) || null;
const makeId = () => crypto.randomUUID?.() || `ws-${Date.now()}-${Math.random()}`;
const extension = (name) => name.split('.').pop().toLowerCase();
const setStatus = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const markDirty = (dirty) => { state.dirty = dirty; $('save').textContent = dirty ? '保存 ●' : '保存'; };

function db() { return new Promise((resolve, reject) => { const request = indexedDB.open('sql-file-shelf', 1); request.onupgradeneeded = () => request.result.createObjectStore('settings'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function get(key) { const database = await db(); return new Promise((resolve, reject) => { const request = database.transaction('settings').objectStore('settings').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function put(key, value) { const database = await db(); return new Promise((resolve, reject) => { const request = database.transaction('settings', 'readwrite').objectStore('settings').put(value, key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }
async function persist() { await put('workspaces', state.workspaces); await put('activeWorkspaceId', state.activeWorkspaceId); }
async function permission(handle) { return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'; }

function updateEditorInfo() {
  const active = state.active; const disabled = !active;
  ['save', 'saveAs', 'encodingSelect'].forEach((id) => { $(id).disabled = disabled; });
  if (!active) return;
  $('encoding').textContent = active.metadata.encoding; $('bom').textContent = active.metadata.bom ? active.metadata.bom.toUpperCase() : '无';
  $('newline').textContent = active.newline === 'crlf' ? 'CRLF' : active.newline === 'cr' ? 'CR' : 'LF'; $('encodingSelect').value = active.metadata.encoding;
}

async function walk(directory, path = '') {
  const result = [];
  for await (const [, handle] of directory.entries()) {
    const relative = path ? `${path}/${handle.name}` : handle.name;
    if (handle.kind === 'directory') result.push(...await walk(handle, relative));
    if (handle.kind === 'file' && ACCEPTED.has(extension(handle.name))) { const file = await handle.getFile(); result.push({ name: handle.name, path: relative, extension: extension(handle.name), modified: file.lastModified, handle, parent: directory }); }
  }
  return result;
}

async function scanWorkspace(workspace) {
  if (!workspace || !(await permission(workspace.handle))) return [];
  const result = await walk(workspace.handle); state.fileCache.set(workspace.id, result); return result;
}

async function selectWorkspace(id) {
  if (state.dirty && !confirm('当前文件尚未保存，仍要切换工作区吗？')) return;
  state.activeWorkspaceId = id; await persist(); const workspace = current();
  if (workspace && await permission(workspace.handle)) { setStatus(`正在读取 ${workspace.name}…`); await scanWorkspace(workspace); setStatus(`已读取 ${workspace.name}。`); }
  await render();
}

async function addWorkspace() {
  if (!('showDirectoryPicker' in window)) return setStatus('当前浏览器不支持本地目录选择，请使用 Microsoft Edge。', true);
  try {
    const handle = await showDirectoryPicker({ mode: 'readwrite' });
    const existing = (await Promise.all(state.workspaces.map(async (item) => (await item.handle.isSameEntry(handle)) ? item : null))).find(Boolean);
    if (existing) { await selectWorkspace(existing.id); return; }
    const workspace = { id: makeId(), name: handle.name, handle }; state.workspaces.push(workspace); state.activeWorkspaceId = workspace.id;
    await persist(); await scanWorkspace(workspace); await render(); setStatus(`已添加并记住工作区：${workspace.name}`);
  } catch (error) { if (error.name !== 'AbortError') setStatus(`无法添加工作区：${error.message}`, true); }
}

async function requestAccess(id) {
  const workspace = state.workspaces.find((item) => item.id === id); if (!workspace) return;
  try {
    // This is deliberately the first privileged call after the user's click.
    const granted = await workspace.handle.requestPermission({ mode: 'readwrite' });
    if (granted !== 'granted') return setStatus(`没有获得“${workspace.name}”的读写授权。`, true);
    await selectWorkspace(id);
  } catch (error) { setStatus(`恢复访问失败：${error.message}`, true); }
}

async function removeWorkspace(id) {
  const workspace = state.workspaces.find((item) => item.id === id);
  if (!workspace || !confirm(`从工具中移除“${workspace.name}”？本地文件不会删除。`)) return;
  const result = store.removeWorkspace(state.workspaces, id, state.activeWorkspaceId); state.workspaces = result.workspaces; state.activeWorkspaceId = result.activeId; state.fileCache.delete(id);
  if (state.active?.workspaceId === id) { state.active = null; $('editor').value = ''; $('editor').disabled = true; markDirty(false); updateEditorInfo(); }
  await persist(); await render();
}

async function openFile(workspaceId, entry) {
  try {
    if (state.dirty && !confirm('当前文件尚未保存，仍要打开其他文件吗？')) return;
    const bytes = new Uint8Array(await (await entry.handle.getFile()).arrayBuffer()); const metadata = codec.detectEncoding(bytes); const text = codec.decodeFileBytes(bytes, metadata);
    state.active = { workspaceId, ...entry, metadata, newline: codec.detectNewline(text) }; $('editor').value = text; $('editor').disabled = false;
    const workspace = state.workspaces.find((item) => item.id === workspaceId); $('fileTitle').textContent = entry.name; $('filePath').textContent = `${workspace.name} / ${entry.path}`; markDirty(false); updateEditorInfo(); await renderFiles();
  } catch (error) { setStatus(`无法打开文件：${error.message}`, true); }
}

async function renderWorkspaces() {
  const list = $('workspaceList'); list.replaceChildren(); $('workspaceCount').textContent = `${state.workspaces.length} 个`;
  $('workspaceSummary').textContent = state.workspaces.length ? `已记住 ${state.workspaces.length} 个工作区` : '新增一个本地目录作为工作区';
  for (const item of state.workspaces) {
    const row = document.createElement('div'); row.className = 'workspace'; const pick = document.createElement('button'); pick.textContent = `▣ ${item.name}`; if (item.id === state.activeWorkspaceId) pick.className = 'active'; pick.addEventListener('click', () => selectWorkspace(item.id));
    const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = '×'; remove.title = '移除工作区'; remove.addEventListener('click', () => removeWorkspace(item.id)); row.append(pick, remove); list.append(row);
    if (!(await permission(item.handle))) { const grant = document.createElement('button'); grant.className = 'grant'; grant.textContent = '恢复此目录访问'; grant.addEventListener('click', () => requestAccess(item.id)); list.append(grant); }
  }
  if (!state.workspaces.length) list.innerHTML = '<div class="placeholder">点击“新增工作区”，可逐个添加你的分类目录。</div>';
}

async function renderFiles() {
  const body = $('fileList'); body.replaceChildren(); const workspace = current(); const all = workspace ? state.fileCache.get(workspace.id) || [] : []; const visible = files.filterFiles(all, $('fileSearch').value); $('fileCount').textContent = `${visible.length} 个`; $('fileEmpty').hidden = Boolean(visible.length);
  for (const entry of visible) { const row = document.createElement('tr'); if (state.active?.handle === entry.handle) row.className = 'active'; row.addEventListener('click', () => openFile(workspace.id, entry));
    const name = document.createElement('td'); name.className = 'name'; name.textContent = entry.path; const time = document.createElement('td'); time.className = 'time'; time.textContent = files.formatFileTime(entry.modified); const type = document.createElement('td'); type.className = 'type'; type.textContent = entry.extension; row.append(name, time, type); body.append(row); }
}

async function renderGlobalSearch() {
  const query = $('globalSearch').value.trim(); const target = $('globalResults'); target.replaceChildren(); if (!query) return;
  setStatus('正在搜索所有已授权工作区…'); const term = query.toLocaleLowerCase(); const results = [];
  for (const workspace of state.workspaces) {
    let entries = state.fileCache.get(workspace.id); if (!entries && await permission(workspace.handle)) entries = await scanWorkspace(workspace);
    for (const entry of entries || []) {
      let match = `${entry.name} ${entry.path}`.toLocaleLowerCase().includes(term);
      if (!match) { try { const raw = new Uint8Array(await (await entry.handle.getFile()).arrayBuffer()); match = codec.decodeFileBytes(raw, codec.detectEncoding(raw)).toLocaleLowerCase().includes(term); } catch (_) {} }
      if (match) results.push({ workspace, entry }); if (results.length >= 80) break;
    }
    if (results.length >= 80) break;
  }
  for (const { workspace, entry } of results) { const button = document.createElement('button'); button.className = 'result'; const title = document.createElement('strong'); title.textContent = entry.name; const location = document.createElement('small'); location.textContent = `${workspace.name} / ${entry.path}`; button.append(title, location); button.addEventListener('click', async () => { if (state.activeWorkspaceId !== workspace.id) { state.activeWorkspaceId = workspace.id; await persist(); } await openFile(workspace.id, entry); await render(); }); target.append(button); }
  if (!results.length) target.innerHTML = '<div class="placeholder">没有找到匹配内容。</div>'; setStatus(`找到 ${results.length} 个匹配文件。`);
}

function saveBytes() { const text = codec.normalizeNewlines($('editor').value, state.active.newline); return { text, bytes: codec.encodeForSave(text, state.active.metadata) }; }
async function writeTo(handle, parent, backup) {
  const owner = state.workspaces.find((item) => item.id === state.active.workspaceId); if (!owner || !(await permission(owner.handle))) throw new Error('没有当前工作区的写入权限，请点击“恢复此目录访问”。');
  const { text, bytes } = saveBytes(); if (backup) { const old = await state.active.handle.getFile(); const copy = await parent.getFileHandle(`${handle.name}.bak`, { create: true }); const writer = await copy.createWritable(); await writer.write(await old.arrayBuffer()); await writer.close(); }
  const writer = await handle.createWritable(); await writer.write(bytes); await writer.close(); state.active.handle = handle; state.active.parent = parent; $('editor').value = text; markDirty(false); await scanWorkspace(owner); await renderFiles();
}
async function save() { try { if (!state.active) return; await writeTo(state.active.handle, state.active.parent, true); setStatus('已保存，并生成同目录 .bak 备份。'); } catch (error) { setStatus(error.message, true); } }
async function saveAs() { if (!state.active) return; const owner = state.workspaces.find((item) => item.id === state.active.workspaceId); const name = prompt('另存为（保存到工作区根目录）：', state.active.name); if (!name) return; if (!ACCEPTED.has(extension(name))) return setStatus('仅支持 .sql、.txt、.md。', true); try { const handle = await owner.handle.getFileHandle(name, { create: true }); await writeTo(handle, owner.handle, false); $('fileTitle').textContent = name; $('filePath').textContent = `${owner.name} / ${name}`; setStatus(`已另存为 ${name}。`); } catch (error) { setStatus(`另存失败：${error.message}`, true); } }
function changeEncoding() { if (!state.active) return; state.active.metadata = { encoding: $('encodingSelect').value, bom: null, confidence: 1, source: 'manual' }; markDirty(true); updateEditorInfo(); }

async function render() { await renderWorkspaces(); await renderFiles(); }
async function init() { state.workspaces = store.normalizeWorkspaces(await get('workspaces')); if (!state.workspaces.length) { const legacy = await get('workspace'); if (legacy?.name && legacy.handle) state.workspaces = [{ id: makeId(), name: legacy.name, handle: legacy.handle }]; } state.activeWorkspaceId = store.selectWorkspace(state.workspaces, await get('activeWorkspaceId')); await persist(); navigator.storage?.persist?.(); await render(); setStatus(state.workspaces.length ? '已恢复工作区列表。选择工作区后查看文件。' : '准备就绪。'); }
$('addWorkspace').addEventListener('click', addWorkspace); $('fileSearch').addEventListener('input', renderFiles); $('globalSearch').addEventListener('input', () => { clearTimeout(state.globalTimer); state.globalTimer = setTimeout(renderGlobalSearch, 250); }); $('editor').addEventListener('input', () => markDirty(true)); $('encodingSelect').addEventListener('change', changeEncoding); $('save').addEventListener('click', save); $('saveAs').addEventListener('click', saveAs); window.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } }); window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } }); if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {}); init();
