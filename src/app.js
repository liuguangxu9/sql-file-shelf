const {
  detectEncoding, decodeFileBytes, encodeForSave, detectNewline, normalizeNewlines,
} = require('./codec');

const ACCEPTED = new Set(['sql', 'txt', 'md']);
const state = { root: null, active: null, dirty: false };
const $ = (id) => document.getElementById(id);

function setStatus(message) { $('status').textContent = message; }
function setNotice(message, isError = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', isError);
}
function setDirty(value) {
  state.dirty = value;
  $('dirty').textContent = value ? '● 未保存' : '';
}
function extension(name) { return name.split('.').pop().toLowerCase(); }
function displayBom(bom) { return bom ? bom.toUpperCase() : '无'; }
function displayNewline(style) { return style === 'crlf' ? 'CRLF' : style === 'cr' ? 'CR' : 'LF'; }

function updateInspector() {
  const active = state.active;
  const disabled = !active;
  ['save', 'saveAs', 'encodingSelect'].forEach((id) => { $(id).disabled = disabled; });
  if (!active) return;
  const { metadata, newline } = active;
  $('encoding').textContent = metadata.encoding;
  $('bom').textContent = displayBom(metadata.bom);
  $('newline').textContent = displayNewline(newline);
  $('confidence').textContent = `${Math.round(metadata.confidence * 100)}% (${metadata.source})`;
  $('encodingSelect').value = metadata.encoding;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sql-file-shelf', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('settings', 'readonly').objectStore('settings').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('settings', 'readwrite').objectStore('settings').put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function permission(handle, request = false) {
  const opts = { mode: 'readwrite' };
  if (await handle.queryPermission(opts) === 'granted') return true;
  return request && (await handle.requestPermission(opts)) === 'granted';
}

async function chooseWorkspace() {
  try {
    const root = await window.showDirectoryPicker({ mode: 'readwrite' });
    state.root = root;
    await idbSet('workspace', root);
    await loadWorkspace(true);
  } catch (error) {
    if (error.name !== 'AbortError') setStatus(`未能选择工作区：${error.message}`);
  }
}

async function restoreWorkspace() {
  try {
    state.root = state.root || await idbGet('workspace');
    if (!state.root) return setStatus('没有已记住的工作区，请先选择目录。');
    await loadWorkspace(true);
  } catch (error) { setStatus(`恢复工作区失败：${error.message}`); }
}

async function loadWorkspace(requestPermission = false) {
  if (!state.root) return;
  if (!(await permission(state.root, requestPermission))) {
    $('workspace').textContent = `${state.root.name}（需要重新授权）`;
    setStatus('请点击“恢复访问”并在 Edge 的提示中授予目录读写权限。');
    return;
  }
  $('workspace').textContent = `工作区：${state.root.name}`;
  setNotice('目录访问已授权。保存前仍会做编码往返校验和 .bak 备份。');
  await renderTree();
  setStatus('工作区已加载。');
}

async function renderTree() {
  const tree = $('tree');
  tree.replaceChildren();
  const fragment = document.createDocumentFragment();
  await appendDirectory(fragment, state.root, 0);
  tree.append(fragment);
}

async function appendDirectory(parent, directory, depth) {
  const entries = [];
  for await (const [, handle] of directory.entries()) entries.push(handle);
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'directory' ? -1 : 1));
  for (const handle of entries) {
    if (handle.kind === 'directory') {
      const label = document.createElement('div');
      label.className = 'folder'; label.style.paddingLeft = `${depth * 14}px`; label.textContent = `▾ ${handle.name}`; parent.append(label);
      await appendDirectory(parent, handle, depth + 1);
    } else if (ACCEPTED.has(extension(handle.name))) {
      const item = document.createElement('button');
      item.className = 'file'; item.style.paddingLeft = `${16 + depth * 14}px`; item.textContent = handle.name;
      item.addEventListener('click', () => openFile(handle, directory, item));
      parent.append(item);
    }
  }
}

async function openFile(fileHandle, parentDirectory, button) {
  try {
    if (state.dirty && !confirm('当前文件尚未保存，仍要打开其他文件吗？')) return;
    const file = await fileHandle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = detectEncoding(bytes);
    const text = decodeFileBytes(bytes, metadata);
    state.active = { fileHandle, parentDirectory, metadata, newline: detectNewline(text), original: bytes };
    $('editor').value = text; $('editor').disabled = false; $('fileTitle').textContent = fileHandle.name;
    document.querySelectorAll('.tree .active').forEach((node) => node.classList.remove('active')); button.classList.add('active');
    updateInspector(); setDirty(false);
    setNotice(metadata.source === 'heuristic' || metadata.source === 'cjk-heuristic'
      ? `识别到 ${metadata.encoding}（置信度 ${Math.round(metadata.confidence * 100)}%）。请确认右侧编码后再保存。`
      : `已识别 ${metadata.encoding}，保存会保持 BOM 和 ${displayNewline(state.active.newline)} 换行。`);
    setStatus(`已打开 ${fileHandle.name}`);
  } catch (error) { setNotice(`无法打开文件：${error.message}`, true); }
}

function bytesForCurrentEditor() {
  const active = state.active;
  const normalized = normalizeNewlines($('editor').value, active.newline);
  return { text: normalized, bytes: encodeForSave(normalized, active.metadata) };
}

async function writeTo(handle, parentDirectory, makeBackup) {
  if (!state.active || !(await permission(state.root, true))) throw new Error('没有工作区写入权限。');
  const { text, bytes } = bytesForCurrentEditor();
  if (makeBackup) {
    const previous = await state.active.fileHandle.getFile();
    const backup = await parentDirectory.getFileHandle(`${handle.name}.bak`, { create: true });
    const backupWriter = await backup.createWritable();
    await backupWriter.write(await previous.arrayBuffer()); await backupWriter.close();
  }
  const writer = await handle.createWritable();
  await writer.write(bytes); await writer.close();
  state.active.fileHandle = handle; state.active.parentDirectory = parentDirectory; state.active.original = bytes;
  $('editor').value = text; $('fileTitle').textContent = handle.name; setDirty(false); updateInspector();
}

async function save() {
  try {
    if (!state.active) return;
    await writeTo(state.active.fileHandle, state.active.parentDirectory, true);
    setNotice(`已保存 ${state.active.fileHandle.name}；旧版本已写入同目录 .bak 文件。`); setStatus('保存完成。');
  } catch (error) { setNotice(error.message, true); setStatus('保存未执行。'); }
}

async function saveAs() {
  if (!state.active) return;
  const requested = prompt('输入新文件名（保存到工作区根目录）：', state.active.fileHandle.name);
  if (!requested) return;
  if (!ACCEPTED.has(extension(requested))) return setNotice('仅支持 .sql、.txt、.md 文件。', true);
  try {
    const destination = await state.root.getFileHandle(requested, { create: true });
    await writeTo(destination, state.root, false);
    await renderTree(); setNotice(`已另存为 ${requested}。`); setStatus('另存完成。');
  } catch (error) { setNotice(`另存失败：${error.message}`, true); }
}

function setManualEncoding() {
  if (!state.active) return;
  const next = $('encodingSelect').value;
  if (next !== state.active.metadata.encoding) state.active.metadata = { encoding: next, bom: null, confidence: 1, source: 'manual' };
  updateInspector(); setDirty(true); setNotice(`保存时将使用 ${next}。若文本不能无损表示，保存会被阻止。`);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

$('openWorkspace').addEventListener('click', chooseWorkspace);
$('restoreWorkspace').addEventListener('click', restoreWorkspace);
$('editor').addEventListener('input', () => setDirty(true));
$('encodingSelect').addEventListener('change', setManualEncoding);
$('save').addEventListener('click', save);
$('saveAs').addEventListener('click', saveAs);
window.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
registerServiceWorker();
restoreWorkspace();
