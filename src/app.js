const codec = require('./codec');
const store = require('./workspace-store');

const ACCEPTED = new Set(['sql', 'txt', 'md']);
const state = { workspaces: [], activeWorkspaceId: null, active: null, dirty: false };
const $ = (key) => document.getElementById(key);
const currentWorkspace = () => state.workspaces.find((item) => item.id === state.activeWorkspaceId) || null;
const extension = (name) => name.split('.').pop().toLowerCase();
const makeId = () => crypto.randomUUID?.() || `ws-${Date.now()}-${Math.random()}`;
const status = (message) => { $('status').textContent = message; };
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', error); };
const markDirty = (value) => { state.dirty = value; $('dirty').textContent = value ? '● 未保存' : ''; };

function updateInspector() {
  const disabled = !state.active;
  for (const id of ['save', 'saveAs', 'encodingSelect']) $(id).disabled = disabled;
  if (!state.active) return;
  const { metadata, newline } = state.active;
  $('encoding').textContent = metadata.encoding;
  $('bom').textContent = metadata.bom ? metadata.bom.toUpperCase() : '无';
  $('newline').textContent = newline === 'crlf' ? 'CRLF' : newline === 'cr' ? 'CR' : 'LF';
  $('confidence').textContent = `${Math.round(metadata.confidence * 100)}% (${metadata.source})`;
  $('encodingSelect').value = metadata.encoding;
}

function db() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sql-file-shelf', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function get(key) { const database = await db(); return new Promise((resolve, reject) => { const request = database.transaction('settings').objectStore('settings').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function put(key, value) { const database = await db(); return new Promise((resolve, reject) => { const request = database.transaction('settings', 'readwrite').objectStore('settings').put(value, key); request.onsuccess = resolve; request.onerror = () => reject(request.error); }); }
async function persist() { await put('workspaces', state.workspaces); await put('activeWorkspaceId', state.activeWorkspaceId); }
async function hasPermission(handle, request = false) { const opts = { mode: 'readwrite' }; return (await handle.queryPermission(opts)) === 'granted' || (request && (await handle.requestPermission(opts)) === 'granted'); }

async function addWorkspace() {
  if (!('showDirectoryPicker' in window)) return notice('当前浏览器不支持本地目录选择。请在 Microsoft Edge 中打开此工具。', true);
  try {
    const handle = await showDirectoryPicker({ mode: 'readwrite' });
    const same = await Promise.all(state.workspaces.map(async (item) => (await item.handle.isSameEntry(handle)) ? item : null));
    const existing = same.find(Boolean);
    if (existing) state.activeWorkspaceId = existing.id;
    else { state.workspaces.push({ id: makeId(), name: handle.name, handle }); state.activeWorkspaceId = state.workspaces.at(-1).id; }
    await persist(); await renderWorkspaces(); status(existing ? `已切换到 ${existing.name}` : `已添加工作区：${handle.name}`);
  } catch (error) { if (error.name !== 'AbortError') notice(`无法添加工作区：${error.message}`, true); }
}

async function restoreWorkspace(id = state.activeWorkspaceId) {
  const item = state.workspaces.find((workspace) => workspace.id === id);
  if (!item) return status('请先新增工作区。');
  state.activeWorkspaceId = item.id;
  if (!(await hasPermission(item.handle, true))) return notice(`没有“${item.name}”的读写授权。`, true);
  await persist(); await renderWorkspaces(); status(`已恢复工作区：${item.name}`);
}

async function removeWorkspace(id) {
  const item = state.workspaces.find((workspace) => workspace.id === id);
  if (!item || !confirm(`从工具中移除“${item.name}”？本地文件不会删除。`)) return;
  const result = store.removeWorkspace(state.workspaces, id, state.activeWorkspaceId);
  state.workspaces = result.workspaces; state.activeWorkspaceId = result.activeId;
  if (state.active?.workspaceId === id) { state.active = null; $('editor').value = ''; $('editor').disabled = true; $('fileTitle').textContent = '尚未打开文件'; markDirty(false); updateInspector(); }
  await persist(); await renderWorkspaces(); status(`已移除工作区：${item.name}`);
}

async function restoreSavedWorkspaces() {
  state.workspaces = store.normalizeWorkspaces(await get('workspaces'));
  if (!state.workspaces.length) { const legacy = await get('workspace'); if (legacy?.name) state.workspaces.push({ id: makeId(), name: legacy.name, handle: legacy }); }
  state.activeWorkspaceId = store.selectWorkspace(state.workspaces, await get('activeWorkspaceId'));
  await persist(); await renderWorkspaces(); status(state.workspaces.length ? '已恢复工作区列表。点击工作区或“恢复访问”后开始编辑。' : '还没有工作区，请点击“新增工作区”。');
}

async function renderWorkspaces() {
  const tree = $('tree'); tree.replaceChildren();
  const active = currentWorkspace(); $('workspace').textContent = state.workspaces.length ? `已配置 ${state.workspaces.length} 个工作区${active ? ` · 当前：${active.name}` : ''}` : '未选择工作区';
  if (!state.workspaces.length) { tree.innerHTML = '<div class="empty">点击“新增工作区”，选择一个本地目录。</div>'; return; }
  for (const item of state.workspaces) {
    const group = document.createElement('section'); group.className = 'workspaceGroup';
    const header = document.createElement('div'); header.className = 'workspaceHeader';
    const select = document.createElement('button'); select.textContent = `▣ ${item.name}`; if (item.id === state.activeWorkspaceId) select.className = 'active';
    select.addEventListener('click', async () => { if (state.dirty && !confirm('当前文件尚未保存，仍要切换工作区吗？')) return; state.activeWorkspaceId = item.id; await persist(); await renderWorkspaces(); });
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = '移除此工作区'; remove.className = 'removeWorkspace'; remove.addEventListener('click', () => removeWorkspace(item.id)); header.append(select, remove); group.append(header);
    if (await hasPermission(item.handle)) await appendDirectory(group, item, item.handle, 0);
    else { const grant = document.createElement('button'); grant.textContent = '恢复此目录访问'; grant.className = 'grant'; grant.addEventListener('click', () => restoreWorkspace(item.id)); group.append(grant); }
    tree.append(group);
  }
}

async function appendDirectory(parent, owner, directory, depth) {
  const entries = []; for await (const [, handle] of directory.entries()) entries.push(handle);
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'directory' ? -1 : 1));
  for (const handle of entries) {
    if (handle.kind === 'directory') { const label = document.createElement('div'); label.className = 'folder'; label.style.paddingLeft = `${10 + depth * 14}px`; label.textContent = `▾ ${handle.name}`; parent.append(label); await appendDirectory(parent, owner, handle, depth + 1); }
    if (handle.kind === 'file' && ACCEPTED.has(extension(handle.name))) { const button = document.createElement('button'); button.className = 'file'; button.style.paddingLeft = `${20 + depth * 14}px`; button.textContent = handle.name; button.addEventListener('click', () => openFile(owner, handle, directory, button)); parent.append(button); }
  }
}

async function openFile(owner, fileHandle, parentDirectory, button) {
  try {
    if (state.dirty && !confirm('当前文件尚未保存，仍要打开其他文件吗？')) return;
    const bytes = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer()); const metadata = codec.detectEncoding(bytes); const text = codec.decodeFileBytes(bytes, metadata);
    state.active = { workspaceId: owner.id, fileHandle, parentDirectory, metadata, newline: codec.detectNewline(text) }; state.activeWorkspaceId = owner.id;
    $('editor').value = text; $('editor').disabled = false; $('fileTitle').textContent = `${owner.name} / ${fileHandle.name}`; document.querySelectorAll('.tree .file.active').forEach((node) => node.classList.remove('active')); button.classList.add('active'); updateInspector(); markDirty(false);
    notice(metadata.source.includes('heuristic') ? `识别到 ${metadata.encoding}（${Math.round(metadata.confidence * 100)}%）。请确认后保存。` : `保存会保持原编码、BOM 和换行符。`);
  } catch (error) { notice(`无法打开文件：${error.message}`, true); }
}

function bytesForSave() { const text = codec.normalizeNewlines($('editor').value, state.active.newline); return { text, bytes: codec.encodeForSave(text, state.active.metadata) }; }
async function writeTo(handle, directory, backup) {
  const owner = state.workspaces.find((item) => item.id === state.active.workspaceId);
  if (!owner || !(await hasPermission(owner.handle, true))) throw new Error('没有当前工作区的写入权限。');
  const { text, bytes } = bytesForSave();
  if (backup) { const old = await state.active.fileHandle.getFile(); const copy = await directory.getFileHandle(`${handle.name}.bak`, { create: true }); const writer = await copy.createWritable(); await writer.write(await old.arrayBuffer()); await writer.close(); }
  const writer = await handle.createWritable(); await writer.write(bytes); await writer.close(); state.active.fileHandle = handle; state.active.parentDirectory = directory; $('editor').value = text; markDirty(false); updateInspector();
}
async function save() { try { if (!state.active) return; await writeTo(state.active.fileHandle, state.active.parentDirectory, true); notice('已保存；旧版本已生成同目录 .bak 备份。'); status('保存完成。'); } catch (error) { notice(error.message, true); } }
async function saveAs() {
  if (!state.active) return; const owner = state.workspaces.find((item) => item.id === state.active.workspaceId); const name = prompt(`输入新文件名（保存到“${owner.name}”根目录）：`, state.active.fileHandle.name);
  if (!name) return; if (!ACCEPTED.has(extension(name))) return notice('仅支持 .sql、.txt、.md 文件。', true);
  try { const file = await owner.handle.getFileHandle(name, { create: true }); await writeTo(file, owner.handle, false); $('fileTitle').textContent = `${owner.name} / ${name}`; await renderWorkspaces(); notice(`已另存为 ${name}。`); } catch (error) { notice(`另存失败：${error.message}`, true); }
}
function changeEncoding() { if (!state.active) return; const encoding = $('encodingSelect').value; if (encoding !== state.active.metadata.encoding) state.active.metadata = { encoding, bom: null, confidence: 1, source: 'manual' }; updateInspector(); markDirty(true); }

$('openWorkspace').textContent = '新增工作区'; $('restoreWorkspace').textContent = '恢复访问';
$('openWorkspace').addEventListener('click', addWorkspace); $('restoreWorkspace').addEventListener('click', () => restoreWorkspace());
$('editor').addEventListener('input', () => markDirty(true)); $('encodingSelect').addEventListener('change', changeEncoding); $('save').addEventListener('click', save); $('saveAs').addEventListener('click', saveAs);
window.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
restoreSavedWorkspaces();
