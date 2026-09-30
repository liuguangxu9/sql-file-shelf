const codec = require("./codec");
const { decodeAsync } = require("./async-codec");
const store = require("./workspace-store");
const files = require("./file-model");
const operations = require("./file-operations");
const { editIndent } = require("./editor-indent");
const { applyMultiEdit } = require("./multi-cursor");
const { escapeHtml, highlightSql } = require("./highlight");
const { lineStarts, editorWindow } = require("./editor-window");
const ACCEPTED = new Set(["sql", "txt", "md"]);
const MAX_HIGHLIGHT_CHARS = 180000;
const state = {
  workspaces: [],
  activeWorkspaceId: null,
  fileCache: new Map(),
  folderCache: new Map(),
  selectedFolders: new Map(),
  expandedFolders: new Map(),
  active: null,
  dirty: false,
  globalTimer: null,
  fileSort: { key: "modified", direction: "desc" },
  draggingWorkspaceId: null,
  workspaceRenderVersion: 0,
  fileSearchTimer: null,
  editorDecorationTimer: null,
  editorWindowCache: null,
  fileOpenVersion: 0,
  secondaryCursors: [],
  altDrag: null,
  multiComposing: null,
  editorHistory: { undo: [], redo: [], current: null, restoring: false },
};
const $ = (id) => document.getElementById(id);
const current = () =>
  state.workspaces.find((item) => item.id === state.activeWorkspaceId) || null;
const makeId = () =>
  crypto.randomUUID?.() || `ws-${Date.now()}-${Math.random()}`;
const extension = (name) => name.split(".").pop().toLowerCase();
const setStatus = (text, error = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
};
const markDirty = (dirty) => {
  state.dirty = dirty;
  $("save").textContent = dirty ? "保存 ●" : "保存";
};

function db() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("sql-file-shelf", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function get(key) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("settings")
      .objectStore("settings")
      .get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function put(key, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("settings", "readwrite")
      .objectStore("settings")
      .put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function persist() {
  await put("workspaces", state.workspaces);
  await put("activeWorkspaceId", state.activeWorkspaceId);
}
async function permission(handle) {
  return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
}

function updateEditorInfo() {
  const active = state.active;
  const disabled = !active;
  ["save", "saveAs", "encodingSelect"].forEach((id) => {
    $(id).disabled = disabled;
  });
  if (!active) {
    $("encoding").textContent = "—";
    $("bom").textContent = "—";
    $("newline").textContent = "—";
    return;
  }
  $("encoding").textContent = active.metadata.encoding.toUpperCase();
  $("bom").textContent = active.metadata.bom
    ? active.metadata.bom.toUpperCase()
    : "无";
  $("newline").textContent =
    active.newline === "crlf" ? "CRLF" : active.newline === "cr" ? "CR" : "LF";
  $("encodingSelect").value = active.metadata.encoding;
}

function setFileIdentity(name, path) {
  $("fileTitle").textContent = name;
  $("fileTitle").title = name;
  const isLocation = path.endsWith(name);
  const directory = isLocation
    ? path.slice(0, -name.length).replace(/\s*\/\s*$/, "")
    : path;
  $("filePath").textContent = directory;
  $("filePath").title = path;
  $("filePath").classList.toggle("isLocation", isLocation);
}

function clearEditor() {
  state.fileOpenVersion += 1;
  state.active = null;
  clearSecondaryCursors();
  const editor = $("editor");
  editor.value = "";
  resetEditorHistory();
  editor.disabled = true;
  editor.scrollTop = 0;
  editor.scrollLeft = 0;
  setFileIdentity("尚未打开文件", "从中间的文件列表选择文件。");
  markDirty(false);
  updateEditorInfo();
  renderEditorDecorations();
}

async function walk(directory, path = "", folders = [], folderRecord = null) {
  const result = [];
  const childDirectories = [];
  const childFiles = [];
  let entryCount = 0;
  for await (const [, handle] of directory.entries()) {
    entryCount += 1;
    const relative = path ? `${path}/${handle.name}` : handle.name;
    if (handle.kind === "directory") {
      const record = { path: relative, handle, empty: false };
      folders.push(record);
      childDirectories.push({ handle, path: relative, record });
    }
    if (handle.kind === "file" && ACCEPTED.has(extension(handle.name)))
      childFiles.push({ handle, path: relative });
  }
  if (folderRecord) folderRecord.empty = entryCount === 0;
  for (let start = 0; start < childFiles.length; start += 16) {
    const batch = childFiles.slice(start, start + 16);
    const entries = await Promise.all(
      batch.map(async ({ handle, path: relative }) => {
        const file = await handle.getFile();
        return {
          name: handle.name,
          path: relative,
          extension: extension(handle.name),
          modified: file.lastModified,
          handle,
          parent: directory,
        };
      }),
    );
    result.push(...entries);
  }
  for (const child of childDirectories) {
    result.push(...(await walk(child.handle, child.path, folders, child.record)));
  }
  return result;
}

async function scanWorkspace(workspace) {
  if (!workspace || !(await permission(workspace.handle))) return [];
  const folders = [{ path: "", handle: workspace.handle, empty: false }];
  const result = await walk(workspace.handle, "", folders, folders[0]);
  state.fileCache.set(workspace.id, result);
  state.folderCache.set(workspace.id, folders);
  return result;
}

async function refreshCurrentWorkspace() {
  const workspace = current();
  if (!workspace) return setStatus("请先选择一个工作区。", true);
  if (!(await permission(workspace.handle)))
    return setStatus(`“${workspace.name}”尚未获得访问授权。`, true);
  try {
    setStatus(`正在刷新 ${workspace.name}…`);
    await scanWorkspace(workspace);
    await render();
    setStatus(`已刷新 ${workspace.name}。`);
  } catch (error) {
    setStatus(`刷新失败：${error.message}`, true);
  }
}

async function selectWorkspace(id) {
  if (!state.workspaces.some((item) => item.id === id)) return;
  if (id === state.activeWorkspaceId) {
    state.selectedFolders.set(id, "");
    await renderFiles();
    setStatus(`已选中 ${current().name} 根目录，新建文件将保存在此。`);
    return;
  }
  if (id !== state.activeWorkspaceId) {
    if (state.dirty && !confirm("当前文件尚未保存。放弃修改并切换工作区吗？")) return;
    clearEditor();
  }
  state.activeWorkspaceId = id;
  state.selectedFolders.set(id, "");
  await persist();
  const workspace = current();
  if (workspace && (await permission(workspace.handle))) {
    setStatus(`正在读取 ${workspace.name}…`);
    await scanWorkspace(workspace);
    setStatus(`已读取 ${workspace.name}。`);
  }
  await render();
}

async function addWorkspace() {
  if (!("showDirectoryPicker" in window))
    return setStatus(
      "当前浏览器不支持本地目录选择，请使用 Microsoft Edge。",
      true,
    );
  try {
    const handle = await showDirectoryPicker({ mode: "readwrite" });
    const existing = (
      await Promise.all(
        state.workspaces.map(async (item) =>
          (await item.handle.isSameEntry(handle)) ? item : null,
        ),
      )
    ).find(Boolean);
    if (existing) {
      await selectWorkspace(existing.id);
      return;
    }
    if (state.dirty && !confirm("当前文件尚未保存。放弃修改并切换到新工作区吗？")) return;
    clearEditor();
    const workspace = { id: makeId(), name: handle.name, handle };
    state.workspaces.push(workspace);
    state.activeWorkspaceId = workspace.id;
    await persist();
    await scanWorkspace(workspace);
    await render();
    setStatus(`已添加并记住工作区：${workspace.name}`);
  } catch (error) {
    if (error.name !== "AbortError")
      setStatus(`无法添加工作区：${error.message}`, true);
  }
}

async function requestAccess(id) {
  const workspace = state.workspaces.find((item) => item.id === id);
  if (!workspace) return;
  try {
    // This is deliberately the first privileged call after the user's click.
    const granted = await workspace.handle.requestPermission({
      mode: "readwrite",
    });
    if (granted !== "granted")
      return setStatus(`没有获得“${workspace.name}”的读写授权。`, true);
    await selectWorkspace(id);
  } catch (error) {
    setStatus(`恢复访问失败：${error.message}`, true);
  }
}

async function removeWorkspace(id) {
  const workspace = state.workspaces.find((item) => item.id === id);
  if (!workspace) return;
  const message = state.activeWorkspaceId === id && state.dirty
    ? `当前文件尚未保存。放弃修改并从工具中移除“${workspace.name}”吗？本地文件不会删除。`
    : `从工具中移除“${workspace.name}”？本地文件不会删除。`;
  if (!confirm(message)) return;
  const result = store.removeWorkspace(
    state.workspaces,
    id,
    state.activeWorkspaceId,
  );
  state.workspaces = result.workspaces;
  state.activeWorkspaceId = result.activeId;
  state.fileCache.delete(id);
  state.folderCache.delete(id);
  state.selectedFolders.delete(id);
  state.expandedFolders.delete(id);
  if (state.active?.workspaceId === id) {
    clearEditor();
  }
  await persist();
  await render();
}

async function openFile(workspaceId, entry) {
  let version;
  try {
    if (state.dirty && state.active?.workspaceId === workspaceId &&
      state.active.path === entry.path) return true;
    if (state.dirty && !confirm("当前文件尚未保存，仍要打开其他文件吗？"))
      return false;
    if (!state.dirty && state.active?.workspaceId === workspaceId &&
      state.active.path === entry.path) return true;
    version = ++state.fileOpenVersion;
    setStatus(`正在打开 ${entry.name}…`);
    updateFileSelection(entry.path, workspaceId);
    const bytes = await operations.readBytes(entry.handle);
    if (version !== state.fileOpenVersion) return false;
    const { metadata, text, newline } = await decodeAsync(bytes);
    if (version !== state.fileOpenVersion) return false;
    state.active = {
      workspaceId,
      ...entry,
      metadata,
      newline,
      originalBytes: bytes,
    };
    clearSecondaryCursors();
    $("editor").value = text;
    $("editor").scrollTop = 0;
    $("editor").scrollLeft = 0;
    resetEditorHistory();
    $("editor").disabled = false;
    renderEditorDecorations();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    setFileIdentity(entry.name, `${workspace.name} / ${entry.path}`);
    markDirty(false);
    updateEditorInfo();
    updateFileSelection();
    setStatus(`已打开 ${entry.name}。`);
    return true;
  } catch (error) {
    if (version !== undefined && version !== state.fileOpenVersion) return false;
    updateFileSelection();
    setStatus(`无法打开文件：${error.message}`, true);
    return false;
  }
}

function updateFileSelection(path = state.active?.path, workspaceId = state.active?.workspaceId) {
  for (const row of $("fileList").querySelectorAll(".fileRow")) {
    row.classList.toggle("active", workspaceId === state.activeWorkspaceId &&
      row.dataset.path === path);
  }
}

async function newFile() {
  const workspace = current();
  if (!workspace) return setStatus("请先选择一个工作区。", true);
  if (!(await permission(workspace.handle)))
    return setStatus(`“${workspace.name}”尚未获得访问授权。`, true);
  const folder = selectedFolder(workspace);
  const requestedName = prompt(
    `在「${folder.path || workspace.name}」中新建文件：`,
    "untitled.sql",
  );
  if (requestedName === null) return;
  const result = files.validateNewFileName(requestedName);
  if (!result.valid) return result.error && setStatus(result.error, true);
  try {
    const existing = (state.fileCache.get(workspace.id) || []).find(
      (entry) => entry.path === joinedPath(folder.path, result.name),
    );
    if (existing && !confirm(`“${result.name}”已存在。是否打开它？`)) return;
    await folder.handle.getFileHandle(result.name, { create: true });
    await scanWorkspace(workspace);
    const entry = (state.fileCache.get(workspace.id) || []).find(
      (item) => item.path === joinedPath(folder.path, result.name),
    );
    if (entry) await openFile(workspace.id, entry);
    setStatus(existing ? `已打开 ${result.name}。` : `已新建 ${result.name}。`);
  } catch (error) {
    setStatus(`新建失败：${error.message}`, true);
  }
}

const joinedPath = (folder, name) => (folder ? `${folder}/${name}` : name);

function selectedFolder(workspace) {
  return (state.folderCache.get(workspace.id) || []).find(
    (folder) => folder.path === state.selectedFolders.get(workspace.id),
  ) || { path: "", handle: workspace.handle };
}

function expandedFolders(workspaceId) {
  if (!state.expandedFolders.has(workspaceId))
    state.expandedFolders.set(workspaceId, new Set([""]));
  return state.expandedFolders.get(workspaceId);
}

function toggleFolderPath(path) {
  const workspace = current();
  if (!workspace) return;
  const body = $("fileList");
  const before = new Map([...body.children].map((row) => [row.dataset.path, row.getBoundingClientRect().top]));
  const expanded = expandedFolders(workspace.id);
  const wasOpen = Boolean($("fileSearch").value.trim()) || expanded.has(path);
  state.selectedFolders.set(workspace.id, path);
  if (wasOpen) expanded.delete(path);
  else expanded.add(path);
  if ($("fileSearch").value) {
    $("fileSearch").value = "";
    clearTimeout(state.fileSearchTimer);
  }
  renderFiles();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || body.children.length > 160) return;
  for (const row of body.children) {
    const previousTop = before.get(row.dataset.path);
    if (previousTop === undefined) {
      row.animate(
        [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 170, easing: "cubic-bezier(.2,.7,.25,1)" },
      );
    } else {
      const delta = previousTop - row.getBoundingClientRect().top;
      if (Math.abs(delta) > 1)
        row.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
          { duration: 190, easing: "cubic-bezier(.2,.7,.25,1)" },
        );
    }
  }
  body.querySelectorAll(".folderRow").forEach((row) => {
    if (row.dataset.path !== path) return;
    row.querySelector(".treeToggle svg")?.animate(
      [{ transform: `rotate(${wasOpen ? 90 : 0}deg)` }, { transform: `rotate(${wasOpen ? 0 : 90}deg)` }],
      { duration: 170, easing: "ease-out" },
    );
  });
}

async function newFolder() {
  const workspace = current();
  if (!workspace || !(await permission(workspace.handle)))
    return setStatus("请先选择并授权一个工作区。", true);
  const parent = selectedFolder(workspace);
  const requested = prompt(`在 ${parent.path || "工作区根目录"} 下新建目录：`, "新目录");
  if (requested === null) return;
  const result = files.validateFolderName(requested);
  if (!result.valid) return setStatus(result.error, true);
  const path = joinedPath(parent.path, result.name);
  if ((state.folderCache.get(workspace.id) || []).some((item) => item.path === path))
    return setStatus(`目录“${path}”已存在。`, true);
  try {
    await parent.handle.getDirectoryHandle(result.name, { create: true });
    await scanWorkspace(workspace);
    state.selectedFolders.set(workspace.id, path);
    expandedFolders(workspace.id).add(path);
    await renderFiles();
    setStatus(`已新建目录 ${path}。`);
  } catch (error) {
    setStatus(`新建目录失败：${error.message}`, true);
  }
}

async function deleteFile(entry) {
  const workspace = current();
  if (
    !workspace ||
    !entry ||
    !confirm(`确定要永久删除“${entry.path}”吗？此操作无法撤销。`)
  )
    return;
  if (!(await permission(workspace.handle)))
    return setStatus(`“${workspace.name}”尚未获得访问授权。`, true);
  try {
    await entry.parent.removeEntry(entry.name);
    if (
      state.active?.workspaceId === workspace.id &&
      state.active.path === entry.path
    ) {
      clearEditor();
    }
    await scanWorkspace(workspace);
    await render();
    setStatus(`已删除 ${entry.path}。`);
  } catch (error) {
    setStatus(`删除失败：${error.message}`, true);
  }
}

async function deleteFolder(folder) {
  const workspace = current();
  if (!workspace || !folder?.path || !folder.empty ||
      !confirm(`确定要永久删除空目录“${folder.path}”吗？此操作无法撤销。`)) return;
  if (!(await permission(workspace.handle)))
    return setStatus(`“${workspace.name}”尚未获得访问授权。`, true);
  const parentPath = folder.path.includes("/")
    ? folder.path.slice(0, folder.path.lastIndexOf("/"))
    : "";
  const parent = (state.folderCache.get(workspace.id) || []).find((item) => item.path === parentPath);
  if (!parent) return setStatus("父目录已失效，请刷新文件列表。", true);
  try {
    await operations.removeEmptyDirectory(folder.handle, parent.handle, folder.handle.name);
    if (state.selectedFolders.get(workspace.id) === folder.path)
      state.selectedFolders.set(workspace.id, parentPath);
    expandedFolders(workspace.id).delete(folder.path);
    await scanWorkspace(workspace);
    await renderFiles();
    setStatus(`已删除空目录 ${folder.path}。`);
  } catch (error) {
    setStatus(`删除目录失败：${error.message}`, true);
  }
}

function chooseFileLocation(entry, folders) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "fileDialog";
    const heading = document.createElement("h2");
    heading.textContent = "重命名或移动文件";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "文件名";
    const name = document.createElement("input");
    name.value = entry.name;
    nameLabel.append(name);
    const folderLabel = document.createElement("label");
    folderLabel.textContent = "目标目录";
    const folder = document.createElement("select");
    const currentPath = entry.path.slice(0, entry.path.length - entry.name.length).replace(/\/$/, "");
    for (const item of folders) {
      const option = document.createElement("option");
      option.value = item.path;
      option.textContent = item.path || "工作区根目录";
      folder.append(option);
    }
    folder.value = currentPath;
    folderLabel.append(folder);
    const actions = document.createElement("div");
    actions.className = "dialogActions";
    const cancel = document.createElement("button");
    cancel.textContent = "取消";
    const apply = document.createElement("button");
    apply.className = "primary";
    apply.textContent = "应用";
    actions.append(cancel, apply);
    dialog.append(heading, nameLabel, folderLabel, actions);
    document.body.append(dialog);
    let answer = null;
    cancel.addEventListener("click", () => dialog.close());
    apply.addEventListener("click", () => {
      answer = { name: name.value, path: folder.value };
      dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(answer);
    }, { once: true });
    dialog.showModal();
    name.focus();
    name.select();
  });
}

async function editFileLocation(entry) {
  const workspace = current();
  if (!workspace || !(await permission(workspace.handle)))
    return setStatus("请先恢复工作区访问权限。", true);
  if (state.dirty && state.active?.workspaceId === workspace.id && state.active.path === entry.path)
    return setStatus("请先保存当前文件，再重命名或移动。", true);
  const folders = state.folderCache.get(workspace.id) || [];
  const choice = await chooseFileLocation(entry, folders);
  if (!choice) return;
  const requestedName = choice.name.trim();
  const validated = files.validateNewFileName(
    requestedName.includes(".") ? requestedName : `${requestedName}.${entry.extension}`,
  );
  if (!validated.valid) return setStatus(validated.error, true);
  const targetFolder = folders.find((item) => item.path === choice.path);
  if (!targetFolder) return setStatus("目标目录已失效，请刷新文件列表。", true);
  const targetPath = joinedPath(targetFolder.path, validated.name);
  if (targetPath === entry.path) return;
  try {
    await operations.relocateFile(entry, targetFolder.handle, validated.name);
    await scanWorkspace(workspace);
    const moved = (state.fileCache.get(workspace.id) || []).find((item) => item.path === targetPath);
    if (state.active?.workspaceId === workspace.id && state.active.path === entry.path && moved) {
      markDirty(false);
      await openFile(workspace.id, moved);
    } else {
      await renderFiles();
    }
    setStatus(`已移动或重命名为 ${targetPath}。`);
  } catch (error) {
    setStatus(`操作失败：${error.message}`, true);
  }
}

async function renderWorkspaces() {
  const list = $("workspaceList");
  const version = ++state.workspaceRenderVersion;
  const workspaces = [...state.workspaces];
  const granted = await Promise.all(
    workspaces.map((item) => permission(item.handle).catch(() => false)),
  );
  if (version !== state.workspaceRenderVersion) return;
  const fragment = document.createDocumentFragment();
  $("workspaceCount").textContent = `${workspaces.length} 个`;
  $("workspaceSummary").textContent = workspaces.length
    ? `已记住 ${workspaces.length} 个工作区`
    : "新增一个本地目录作为工作区";
  for (const [index, item] of workspaces.entries()) {
    const row = document.createElement("div");
    row.className = "workspace";
    const pick = document.createElement("button");
    pick.textContent = `⋮⋮  ${item.name}`;
    pick.title = `选择工作区根目录：${item.name}`;
    pick.draggable = true;
    if (item.id === state.activeWorkspaceId) pick.className = "active";
    pick.addEventListener("click", () => selectWorkspace(item.id));
    pick.addEventListener("dragstart", () => {
      state.draggingWorkspaceId = item.id;
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (state.draggingWorkspaceId !== item.id) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      row.classList.remove("drag-over");
      if (!state.draggingWorkspaceId) return;
      state.workspaces = store.moveWorkspace(
        state.workspaces,
        state.draggingWorkspaceId,
        item.id,
      );
      state.draggingWorkspaceId = null;
      await persist();
      await renderWorkspaces();
    });
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = "移除工作区";
    remove.addEventListener("click", () => removeWorkspace(item.id));
    row.append(pick, remove);
    fragment.append(row);
    if (!granted[index]) {
      const grant = document.createElement("button");
      grant.className = "grant";
      grant.textContent = "恢复此目录访问";
      grant.addEventListener("click", () => requestAccess(item.id));
      fragment.append(grant);
    }
  }
  if (!workspaces.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "点击“新增工作区”，可逐个添加你的分类目录。";
    fragment.append(empty);
  }
  list.replaceChildren(fragment);
}

async function renderFiles() {
  const body = $("fileList");
  const fragment = document.createDocumentFragment();
  const workspace = current();
  const all = workspace ? state.fileCache.get(workspace.id) || [] : [];
  const folders = workspace ? state.folderCache.get(workspace.id) || [] : [];
  const selected = workspace ? selectedFolder(workspace) : null;
  const tree = workspace && folders.length
    ? files.buildFileTree(folders, all, {
        query: $("fileSearch").value,
        sort: state.fileSort,
        expanded: expandedFolders(workspace.id),
        hideRoot: true,
      })
    : { rows: [], count: 0 };
  $("newFile").disabled = !workspace || !folders.length;
  $("newFolder").disabled = !workspace || !folders.length;
  const target = selected?.path || workspace?.name || "当前目录";
  $("newFile").title = `在「${target}」中新建文件`;
  $("newFolder").title = `在「${target}」中新建子目录`;
  $("fileCount").textContent = `${tree.count} 个文件`;
  $("fileEmpty").hidden = Boolean(tree.rows.length);
  $("fileEmpty").textContent = workspace
    ? "没有匹配的文件，可选中文件夹后新建。"
    : "选择一个已授权工作区后显示文件。";
  updateSortMenu();
  for (const node of tree.rows) {
    const row = document.createElement("div");
    row.dataset.path = node.path;
    if (node.kind === "folder") {
      const searching = Boolean($("fileSearch").value.trim());
      const isOpen = searching || expandedFolders(workspace.id).has(node.path);
      row.className = `folderRow${isOpen ? " open" : ""}${node.path === selected?.path ? " selected" : ""}`;
      row.title = node.path || workspace.name;
      const content = document.createElement("div");
      content.className = "treeNameCell";
      content.style.paddingLeft = `${node.depth * 20}px`;
      const arrow = document.createElement("button");
      arrow.className = "treeToggle";
      arrow.title = searching ? "搜索时自动展开匹配目录" : isOpen ? "收起文件夹" : "展开文件夹";
      arrow.setAttribute("aria-label", `${arrow.title}：${node.path || workspace.name}`);
      arrow.setAttribute("aria-expanded", String(isOpen));
      const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      chevron.setAttribute("viewBox", "0 0 18 18");
      chevron.setAttribute("aria-hidden", "true");
      const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      chevronPath.setAttribute("d", "M6.5 4.5 11.5 9l-5 4.5");
      chevron.append(chevronPath);
      arrow.append(chevron);
      arrow.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFolderPath(node.path);
      });
      const pick = document.createElement("button");
      pick.className = "folderPick";
      pick.textContent = node.path ? node.path.split("/").pop() : workspace.name;
      pick.title = `${isOpen ? "收起" : "展开"} ${node.path || workspace.name}，并选为新建位置`;
      pick.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFolderPath(node.path);
      });
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 20 20");
      icon.setAttribute("aria-hidden", "true");
      icon.classList.add("folderIcon");
      const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
      shape.setAttribute("d", "M2.5 5.5A1.5 1.5 0 0 1 4 4h3.5l1.7 2H16a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 16 17H4a1.5 1.5 0 0 1-1.5-1.5z");
      icon.append(shape);
      row.addEventListener("click", () => toggleFolderPath(node.path));
      content.append(arrow, icon, pick);
      if (node.folder.empty) {
        const remove = document.createElement("button");
        remove.className = "fileDelete folderDelete";
        remove.title = `删除空目录 ${node.path}`;
        remove.setAttribute("aria-label", remove.title);
        remove.textContent = "×";
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteFolder(node.folder);
        });
        content.append(remove);
      }
      row.append(content);
      fragment.append(row);
      continue;
    }
    const entry = node.entry;
    row.className = `fileRow${node.depth ? " nested" : ""}${state.active?.handle === entry.handle ? " active" : ""}`;
    row.style.setProperty("--tree-depth", node.depth);
    row.title = entry.path;
    row.addEventListener("click", () => openFile(workspace.id, entry));
    const content = document.createElement("div");
    content.className = "fileNameCell";
    content.style.paddingLeft = `${node.depth * 20 + 22}px`;
    const icon = document.createElement("span");
    icon.className = "fileIcon";
    icon.textContent = "▤";
    const label = document.createElement("span");
    label.className = "fileNameText";
    label.textContent = entry.name;
    const editLocation = document.createElement("button");
    editLocation.className = "fileAction";
    editLocation.title = `重命名或移动 ${entry.path}`;
    editLocation.setAttribute("aria-label", editLocation.title);
    editLocation.textContent = "⋯";
    editLocation.addEventListener("click", (event) => {
      event.stopPropagation();
      editFileLocation(entry);
    });
    const remove = document.createElement("button");
    remove.className = "fileDelete";
    remove.title = `删除 ${entry.path}`;
    remove.setAttribute("aria-label", remove.title);
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteFile(entry);
    });
    content.append(icon, label);
    const actions = document.createElement("div");
    actions.className = "fileRowActions";
    actions.append(editLocation, remove);
    const meta = document.createElement("div");
    meta.className = "fileMeta";
    meta.style.paddingLeft = `${node.depth * 20 + 40}px`;
    meta.textContent = `${files.formatFileTime(entry.modified)} · ${entry.extension.toUpperCase()}`;
    row.append(content, meta, actions);
    fragment.append(row);
  }
  body.replaceChildren(fragment);
}

function updateSortMenu() {
  const labels = { modified: "修改时间", name: "文件名", extension: "格式" };
  $("fileSortButton").title = `排序：${labels[state.fileSort.key]}${state.fileSort.direction === "asc" ? "升序" : "降序"}`;
  $("fileSortDirection").textContent = state.fileSort.direction === "asc" ? "升序 ↑" : "降序 ↓";
  document.querySelectorAll("[data-sort-key]").forEach((button) => {
    const selected = button.dataset.sortKey === state.fileSort.key;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

async function renderGlobalSearch() {
  const query = $("globalSearch").value.trim();
  const target = $("globalResults");
  target.replaceChildren();
  if (!query) return;
  setStatus("正在搜索所有已授权工作区…");
  const term = query.toLocaleLowerCase();
  const results = [];
  for (const workspace of state.workspaces) {
    let entries = state.fileCache.get(workspace.id);
    if (!entries && (await permission(workspace.handle)))
      entries = await scanWorkspace(workspace);
    for (const entry of entries || []) {
      let match = `${entry.name} ${entry.path}`
        .toLocaleLowerCase()
        .includes(term);
      if (!match) {
        try {
          const raw = new Uint8Array(
            await (await entry.handle.getFile()).arrayBuffer(),
          );
          match = codec
            .decodeFileBytes(raw, codec.detectEncoding(raw))
            .toLocaleLowerCase()
            .includes(term);
        } catch (_) {}
      }
      if (match) results.push({ workspace, entry });
      if (results.length >= 80) break;
    }
    if (results.length >= 80) break;
  }
  for (const { workspace, entry } of results) {
    const button = document.createElement("button");
    button.className = "result";
    const title = document.createElement("strong");
    title.textContent = entry.name;
    const location = document.createElement("small");
    location.textContent = `${workspace.name} / ${entry.path}`;
    button.append(title, location);
    button.addEventListener("click", async () => {
      if (!(await openFile(workspace.id, entry))) return;
      if (state.activeWorkspaceId !== workspace.id) {
        state.activeWorkspaceId = workspace.id;
        await persist();
      }
      await render();
    });
    target.append(button);
  }
  if (!results.length)
    target.innerHTML = '<div class="placeholder">没有找到匹配内容。</div>';
  setStatus(`找到 ${results.length} 个匹配文件。`);
}

function saveBytes() {
  const text = codec.normalizeNewlines($("editor").value, state.active.newline);
  return { text, bytes: codec.encodeForSave(text, state.active.metadata) };
}
class FileConflictError extends Error {
  constructor(diskBytes) {
    super("磁盘上的文件已被其他程序修改。");
    this.diskBytes = diskBytes;
  }
}

async function writeTo(handle, parent, { backup, expectedBytes, name, path, payload }) {
  const owner = state.workspaces.find(
    (item) => item.id === state.active.workspaceId,
  );
  if (!owner || !(await permission(owner.handle)))
    throw new Error("没有当前工作区的写入权限，请点击“恢复此目录访问”。");
  const { text, bytes } = payload || saveBytes();
  const diskBytes = await operations.readBytes(handle);
  if (!operations.sameBytes(expectedBytes, diskBytes))
    throw new FileConflictError(diskBytes);
  if (backup) {
    const copy = await parent.getFileHandle(`${handle.name}.bak`, {
      create: true,
    });
    await operations.writeBytes(copy, diskBytes);
  }
  await operations.writeBytes(handle, bytes);
  Object.assign(state.active, {
    handle, parent, name, path, extension: extension(name), originalBytes: bytes,
  });
  if ($("editor").value !== text) clearSecondaryCursors();
  $("editor").value = text;
  state.editorHistory.current = editorSnapshot();
  setFileIdentity(name, `${owner.name} / ${path}`);
  markDirty(false);
  await scanWorkspace(owner);
  await renderFiles();
  renderEditorDecorations();
}

function showConflict(diskBytes) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "fileDialog conflictDialog";
    const heading = document.createElement("h2");
    heading.textContent = "磁盘文件已有新修改";
    const description = document.createElement("p");
    description.textContent = "请比较两份内容，再选择如何处理。覆盖前会为磁盘版本生成 .bak。";
    const compare = document.createElement("div");
    compare.className = "conflictCompare";
    let diskText;
    try {
      diskText = codec.decodeFileBytes(diskBytes, codec.detectEncoding(diskBytes));
    } catch (error) {
      diskText = `无法预览磁盘版本：${error.message}`;
    }
    for (const [title, value] of [["磁盘版本", diskText], ["当前编辑", $("editor").value]]) {
      const pane = document.createElement("section");
      const label = document.createElement("strong");
      label.textContent = title;
      const preview = document.createElement("pre");
      preview.textContent = value;
      pane.append(label, preview);
      compare.append(pane);
    }
    const actions = document.createElement("div");
    actions.className = "dialogActions";
    for (const [label, value, primary] of [
      ["取消", "cancel", false], ["重新加载磁盘版", "reload", false],
      ["另存为", "saveAs", false], ["覆盖磁盘版", "overwrite", true],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      if (primary) button.className = "primary";
      button.addEventListener("click", () => dialog.close(value));
      actions.append(button);
    }
    dialog.append(heading, description, compare, actions);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      const choice = dialog.returnValue || "cancel";
      dialog.remove();
      resolve(choice);
    }, { once: true });
    dialog.showModal();
  });
}

async function save() {
  try {
    if (!state.active) return;
    let expected = state.active.originalBytes;
    while (true) {
      try {
        await writeTo(state.active.handle, state.active.parent, {
          backup: true, expectedBytes: expected,
          name: state.active.name, path: state.active.path,
        });
        break;
      } catch (error) {
        if (!(error instanceof FileConflictError)) throw error;
        const choice = await showConflict(error.diskBytes);
        if (choice === "saveAs") return saveAs();
        if (choice === "reload") {
          markDirty(false);
          await openFile(state.active.workspaceId, state.active);
          return setStatus("已重新加载磁盘版本。");
        }
        if (choice !== "overwrite") return setStatus("已取消保存；当前编辑内容仍在。", true);
        expected = error.diskBytes;
      }
    }
    setStatus("已保存，并生成同目录 .bak 备份。");
  } catch (error) {
    setStatus(error.message, true);
  }
}
async function saveAs() {
  if (!state.active) return;
  const owner = state.workspaces.find(
    (item) => item.id === state.active.workspaceId,
  );
  const requested = prompt("另存为（保存到工作区根目录）：", state.active.name);
  if (requested === null) return;
  const name = requested.trim().includes(".") ? requested : `${requested}.${state.active.extension}`;
  const validated = files.validateNewFileName(name);
  if (!validated.valid) return setStatus(validated.error, true);
  try {
    const payload = saveBytes();
    const existing = await operations.findFile(owner.handle, validated.name);
    if (existing && await existing.isSameEntry(state.active.handle)) return save();
    if (existing && !confirm(`“${validated.name}”已存在。确定覆盖并保留 .bak 备份吗？`)) return;
    const handle = existing || await owner.handle.getFileHandle(validated.name, { create: true });
    const expectedBytes = await operations.readBytes(handle);
    if (!existing && expectedBytes.length)
      throw new Error("目标文件在另存期间出现，请重新确认文件名。");
    await writeTo(handle, owner.handle, {
      backup: Boolean(existing), expectedBytes, name: validated.name,
      path: validated.name, payload,
    });
    setStatus(`已另存为 ${validated.name}${existing ? "，并备份原文件" : ""}。`);
  } catch (error) {
    setStatus(`另存失败：${error instanceof FileConflictError ? "目标文件在保存前又被修改，请重试。" : error.message}`, true);
  }
}
function changeEncoding() {
  if (!state.active) return;
  state.active.metadata = {
    encoding: $("encodingSelect").value,
    bom: null,
    confidence: 1,
    source: "manual",
  };
  markDirty(true);
  updateEditorInfo();
}

function renderEditorDecorations() {
  clearTimeout(state.editorDecorationTimer);
  const editor = $("editor");
  const text = editor.value;
  const shell = editor.parentElement;
  shell.classList.remove("editing");
  if (text.length > MAX_HIGHLIGHT_CHARS) {
    shell.classList.add("plainEditor");
    $("lineNumberContent").textContent = "";
    $("highlightCode").textContent = "";
    state.editorWindowCache = null;
    return;
  }
  shell.classList.remove("plainEditor");
  renderEditorWindow(true);
}
function renderEditorWindow(force = false) {
  const editor = $("editor");
  if (editor.parentElement.classList.contains("plainEditor") ||
    editor.parentElement.classList.contains("editing")) return;
  const text = editor.value;
  let cache = state.editorWindowCache;
  if (!cache || cache.text !== text) {
    cache = state.editorWindowCache = { text, starts: lineStarts(text) };
  }
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
  const view = editorWindow(cache.starts, text.length, editor.scrollTop, editor.clientHeight, lineHeight);
  const code = $("highlightCode");
  const numbers = $("lineNumberContent");
  if (force || cache.first !== view.first || cache.last !== view.last) {
    code.innerHTML = state.active?.extension === "sql"
      ? highlightSql(text, view) : escapeHtml(text.slice(view.start, view.end));
    numbers.textContent = Array.from({ length: view.last - view.first }, (_, i) => view.first + i + 1).join("\n");
    cache.first = view.first;
    cache.last = view.last;
  }
  const y = view.first * lineHeight - editor.scrollTop;
  code.style.transform = `translate(${-editor.scrollLeft}px, ${y}px)`;
  numbers.style.transform = `translateY(${y}px)`;
}
function scheduleEditorDecorations() {
  $("editor").parentElement.classList.add("editing");
  clearTimeout(state.editorDecorationTimer);
  state.editorDecorationTimer = setTimeout(renderEditorDecorations, 140);
}
function clearSecondaryCursors() {
  state.altDrag = null;
  state.secondaryCursors = [];
  renderSecondaryCursors();
}
function editorMetrics(editor) {
  const style = getComputedStyle(editor);
  const canvas = editorMetrics.canvas || (editorMetrics.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = `${style.fontSize} ${style.fontFamily}`;
  return {
    context,
    lineHeight: parseFloat(style.lineHeight),
    left: parseFloat(style.paddingLeft),
    top: parseFloat(style.paddingTop),
    tabWidth: context.measureText(" ").width * 2,
  };
}
function textWidth(text, metrics) {
  let width = 0;
  for (const character of text) {
    if (character === "\t")
      width = (Math.floor(width / metrics.tabWidth) + 1) * metrics.tabWidth;
    else width += metrics.context.measureText(character).width;
  }
  return width;
}
let cachedEditorText = null;
let cachedEditorLines = null;
function editorLines(value) {
  if (value === cachedEditorText) return cachedEditorLines;
  const starts = [0];
  for (let index = 0; index < value.length; index++)
    if (value[index] === "\n") starts.push(index + 1);
  cachedEditorText = value;
  cachedEditorLines = starts;
  return starts;
}
function editorLineFromY(editor, clientY, metrics, starts) {
  const rect = editor.getBoundingClientRect();
  return Math.max(0, Math.min(starts.length - 1,
    Math.floor((clientY - rect.top + editor.scrollTop - metrics.top) / metrics.lineHeight)));
}
function positionAtEditorLine(editor, line, clientX, metrics, starts) {
  const rect = editor.getBoundingClientRect();
  const start = starts[line];
  const end = line + 1 < starts.length ? starts[line + 1] - 1 : editor.value.length;
  const target = clientX - rect.left + editor.scrollLeft - metrics.left;
  let width = 0;
  for (let position = start; position < end;) {
    const character = String.fromCodePoint(editor.value.codePointAt(position));
    const nextWidth = character === "\t"
      ? (Math.floor(width / metrics.tabWidth) + 1) * metrics.tabWidth
      : width + metrics.context.measureText(character).width;
    if (target < (width + nextWidth) / 2) return position;
    width = nextWidth;
    position += character.length;
  }
  return end;
}
function positionFromEditorPoint(editor, clientX, clientY) {
  const metrics = editorMetrics(editor);
  const starts = editorLines(editor.value);
  const line = editorLineFromY(editor, clientY, metrics, starts);
  return positionAtEditorLine(editor, line, clientX, metrics, starts);
}
function updateAltDrag(drag, clientY) {
  const editor = $("editor");
  const metrics = editorMetrics(editor);
  const starts = editorLines(editor.value);
  const lastLine = editorLineFromY(editor, clientY, metrics, starts);
  editor.setSelectionRange(drag.anchorPosition, drag.anchorPosition);
  state.secondaryCursors = [];
  const first = Math.min(drag.anchorLine, lastLine);
  const last = Math.max(drag.anchorLine, lastLine);
  for (let line = first; line <= last; line++) {
    if (line === drag.anchorLine) continue;
    state.secondaryCursors.push(positionAtEditorLine(
      editor, line, drag.anchorX, metrics, starts));
  }
  renderSecondaryCursors();
}
function renderSecondaryCursors() {
  const overlay = $("secondaryCursors");
  if (!overlay) return;
  overlay.replaceChildren();
  const editor = $("editor");
  if (!editor || !state.secondaryCursors.length) return;
  const metrics = editorMetrics(editor);
  const starts = editorLines(editor.value);
  for (const position of state.secondaryCursors) {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (starts[middle] <= position) low = middle;
      else high = middle - 1;
    }
    const line = low;
    const before = editor.value.slice(starts[line], position);
    const cursor = document.createElement("span");
    cursor.className = "secondaryCursor";
    cursor.style.left = `${metrics.left + textWidth(before, metrics) - editor.scrollLeft}px`;
    cursor.style.top = `${metrics.top + line * metrics.lineHeight - editor.scrollTop}px`;
    cursor.style.height = `${metrics.lineHeight}px`;
    overlay.append(cursor);
  }
}
function applyMultiAction(action, text = "") {
  const editor = $("editor");
  const result = applyMultiEdit(editor.value,
    [editor.selectionStart, ...state.secondaryCursors], action, text);
  if (!result) return;
  editor.value = result.value;
  editor.setSelectionRange(result.positions[0], result.positions[0]);
  state.secondaryCursors = [...new Set(result.positions.slice(1))]
    .filter((position) => position !== result.positions[0]);
  renderSecondaryCursors();
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}
function editorSnapshot() {
  const editor = $("editor");
  return {
    value: editor.value,
    primary: editor.selectionStart,
    secondary: [...state.secondaryCursors],
  };
}
function resetEditorHistory() {
  state.editorHistory.undo = [];
  state.editorHistory.redo = [];
  state.editorHistory.current = editorSnapshot();
}
function rememberEditorInput() {
  const history = state.editorHistory;
  const next = editorSnapshot();
  if (!history.restoring && history.current && history.current.value !== next.value) {
    history.undo.push(history.current);
    while (history.undo.length > 30 ||
      history.undo.reduce((size, item) => size + item.value.length, 0) > 6000000)
      history.undo.shift();
    history.redo = [];
  }
  history.current = next;
}
function restoreEditorHistory(redo = false) {
  const history = state.editorHistory;
  const source = redo ? history.redo : history.undo;
  const target = redo ? history.undo : history.redo;
  if (!source.length) return;
  target.push(editorSnapshot());
  const snapshot = source.pop();
  const editor = $("editor");
  history.restoring = true;
  editor.value = snapshot.value;
  editor.setSelectionRange(snapshot.primary, snapshot.primary);
  state.secondaryCursors = snapshot.secondary;
  renderSecondaryCursors();
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  history.restoring = false;
  history.current = editorSnapshot();
}
function moveCursor(value, position, key) {
  const start = value.lastIndexOf("\n", position - 1) + 1;
  const next = value.indexOf("\n", position);
  const end = next < 0 ? value.length : next;
  if (key === "Home") return start;
  if (key === "End") return end;
  if (key === "ArrowLeft") {
    if (!position) return 0;
    const code = value.charCodeAt(position - 1);
    return position - (code >= 0xdc00 && code <= 0xdfff ? 2 : 1);
  }
  if (key === "ArrowRight") {
    if (position >= value.length) return value.length;
    const code = value.charCodeAt(position);
    return position + (code >= 0xd800 && code <= 0xdbff ? 2 : 1);
  }
  const column = position - start;
  if (key === "ArrowUp") {
    if (!start) return position;
    const previousEnd = start - 1;
    const previousStart = value.lastIndexOf("\n", previousEnd - 1) + 1;
    return Math.min(previousStart + column, previousEnd);
  }
  if (key === "ArrowDown") {
    if (next < 0) return position;
    const followingStart = next + 1;
    const followingEnd = value.indexOf("\n", followingStart);
    return Math.min(followingStart + column,
      followingEnd < 0 ? value.length : followingEnd);
  }
  return position;
}
function setupEditorChrome() {
  const editor = $("editor");
  const shell = document.createElement("div");
  shell.className = "editorShell";
  const lines = document.createElement("pre");
  lines.id = "lineNumbers";
  lines.className = "lineNumbers";
  const numberContent = document.createElement("div");
  numberContent.id = "lineNumberContent";
  lines.append(numberContent);
  const highlight = document.createElement("pre");
  highlight.id = "highlight";
  highlight.className = "highlight";
  const code = document.createElement("code");
  code.id = "highlightCode";
  highlight.append(code);
  const cursors = document.createElement("div");
  cursors.id = "secondaryCursors";
  cursors.className = "secondaryCursors";
  editor.parentElement.insertBefore(shell, editor);
  shell.append(lines, highlight, editor, cursors);
  editor.addEventListener("scroll", () => {
    renderEditorWindow();
    renderSecondaryCursors();
  });
  new ResizeObserver(() => {
    renderEditorWindow();
    renderSecondaryCursors();
  }).observe(editor);
  renderEditorDecorations();
}
function setupResizers() {
  const layout = document.querySelector(".layout");
  const firstPanel = layout.children[0];
  const secondPanel = layout.children[1];
  const left = document.createElement("div");
  const middle = document.createElement("div");
  left.className = middle.className = "resizer";
  left.setAttribute("aria-label", "调整工作区宽度");
  middle.setAttribute("aria-label", "调整文件列表宽度");
  layout.insertBefore(left, secondPanel);
  layout.insertBefore(middle, secondPanel.nextSibling);
  const bind = (bar, variable, minimum) =>
    bar.addEventListener("pointerdown", (event) => {
      const start = event.clientX;
      const initial = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(variable),
        10,
      );
      bar.classList.add("dragging");
      bar.setPointerCapture(event.pointerId);
      const move = (next) => {
        const value = Math.max(
          minimum,
          Math.min(initial + next.clientX - start, window.innerWidth - 430),
        );
        document.documentElement.style.setProperty(variable, `${value}px`);
      };
      const end = async () => {
        bar.classList.remove("dragging");
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", end);
        await put("layout", {
          workspace: getComputedStyle(document.documentElement)
            .getPropertyValue("--workspace-width")
            .trim(),
          files: getComputedStyle(document.documentElement)
            .getPropertyValue("--files-width")
            .trim(),
        });
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", end);
    });
  bind(left, "--workspace-width", 180);
  bind(middle, "--files-width", 260);
}

async function render() {
  await renderWorkspaces();
  await renderFiles();
}
async function init() {
  setupEditorChrome();
  setupResizers();
  const layout = await get("layout");
  if (layout?.workspace)
    document.documentElement.style.setProperty(
      "--workspace-width",
      layout.workspace,
    );
  if (layout?.files)
    document.documentElement.style.setProperty("--files-width", layout.files);
  state.workspaces = store.normalizeWorkspaces(await get("workspaces"));
  if (!state.workspaces.length) {
    const legacy = await get("workspace");
    if (legacy?.name && legacy.handle)
      state.workspaces = [
        { id: makeId(), name: legacy.name, handle: legacy.handle },
      ];
  }
  state.activeWorkspaceId = store.selectWorkspace(
    state.workspaces,
    await get("activeWorkspaceId"),
  );
  await persist();
  navigator.storage?.persist?.();
  const workspace = current();
  if (workspace && (await permission(workspace.handle)))
    await scanWorkspace(workspace);
  await render();
  setStatus(
    workspace
      ? `已恢复 ${workspace.name}${state.fileCache.has(workspace.id) ? "，并刷新文件。" : "；请恢复目录访问后查看文件。"}`
      : "准备就绪。",
  );
}
$("fileSortButton").addEventListener("click", (event) => {
  event.stopPropagation();
  const menu = $("fileSortMenu");
  menu.hidden = !menu.hidden;
  $("fileSortButton").setAttribute("aria-expanded", String(!menu.hidden));
});
document.querySelectorAll("[data-sort-key]").forEach((button) =>
  button.addEventListener("click", () => {
    state.fileSort.key = button.dataset.sortKey;
    $("fileSortMenu").hidden = true;
    $("fileSortButton").setAttribute("aria-expanded", "false");
    renderFiles();
  }),
);
$("fileSortDirection").addEventListener("click", () => {
  state.fileSort.direction = state.fileSort.direction === "asc" ? "desc" : "asc";
  renderFiles();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".sortControl")) {
    $("fileSortMenu").hidden = true;
    $("fileSortButton").setAttribute("aria-expanded", "false");
  }
});
$("addWorkspace").addEventListener("click", addWorkspace);
$("refreshFiles").addEventListener("click", refreshCurrentWorkspace);
$("newFile").addEventListener("click", newFile);
$("newFolder").addEventListener("click", newFolder);
$("fileSearch").addEventListener("input", () => {
  clearTimeout(state.fileSearchTimer);
  state.fileSearchTimer = setTimeout(renderFiles, 120);
});
$("globalSearch").addEventListener("input", () => {
  clearTimeout(state.globalTimer);
  state.globalTimer = setTimeout(renderGlobalSearch, 250);
});
$("editor").addEventListener("input", () => {
  state.fileOpenVersion += 1;
  updateFileSelection();
  rememberEditorInput();
  markDirty(true);
  scheduleEditorDecorations();
});
$("editor").addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if (!event.altKey || event.ctrlKey || event.metaKey) {
    clearSecondaryCursors();
    return;
  }
  event.preventDefault();
  const editor = event.currentTarget;
  editor.focus({ preventScroll: true });
  const metrics = editorMetrics(editor);
  const starts = editorLines(editor.value);
  state.altDrag = {
    anchorX: event.clientX,
    anchorY: event.clientY,
    anchorLine: editorLineFromY(editor, event.clientY, metrics, starts),
    anchorPosition: positionFromEditorPoint(editor, event.clientX, event.clientY),
    active: false,
  };
});
window.addEventListener("mousemove", (event) => {
  const drag = state.altDrag;
  if (!drag) return;
  if (!drag.active && Math.hypot(event.clientX - drag.anchorX,
    event.clientY - drag.anchorY) < 4) return;
  drag.active = true;
  updateAltDrag(drag, event.clientY);
});
window.addEventListener("mouseup", (event) => {
  const drag = state.altDrag;
  if (!drag || event.button !== 0) return;
  state.altDrag = null;
  if (drag.active) {
    updateAltDrag(drag, event.clientY);
    setStatus(`${state.secondaryCursors.length + 1} 个光标，可同时输入或粘贴。`);
    return;
  }
  const editor = $("editor");
  const position = drag.anchorPosition;
  const index = state.secondaryCursors.indexOf(position);
  if (index >= 0) state.secondaryCursors.splice(index, 1);
  else if (position !== editor.selectionStart) state.secondaryCursors.push(position);
  renderSecondaryCursors();
  if (state.secondaryCursors.length)
    setStatus(`${state.secondaryCursors.length + 1} 个光标，可同时输入或粘贴。`);
});
$("editor").addEventListener("paste", (event) => {
  if (!state.secondaryCursors.length) return;
  event.preventDefault();
  applyMultiAction("insert", event.clipboardData.getData("text/plain"));
});
$("editor").addEventListener("beforeinput", (event) => {
  if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
    event.preventDefault();
    restoreEditorHistory(event.inputType === "historyRedo");
    return;
  }
  if (!state.secondaryCursors.length || event.isComposing || state.multiComposing ||
    event.inputType !== "insertText" || !event.data) return;
  event.preventDefault();
  applyMultiAction("insert", event.data);
});
$("editor").addEventListener("compositionstart", (event) => {
  if (!state.secondaryCursors.length) return;
  const editor = event.currentTarget;
  state.multiComposing = {
    value: editor.value,
    positions: [editor.selectionStart, ...state.secondaryCursors],
  };
});
$("editor").addEventListener("compositionend", (event) => {
  const original = state.multiComposing;
  state.multiComposing = null;
  if (!original) return;
  const editor = event.currentTarget;
  let prefix = 0;
  while (prefix < original.value.length && prefix < editor.value.length &&
    original.value[prefix] === editor.value[prefix]) prefix++;
  let suffix = 0;
  while (suffix < original.value.length - prefix && suffix < editor.value.length - prefix &&
    original.value[original.value.length - suffix - 1] ===
      editor.value[editor.value.length - suffix - 1]) suffix++;
  const inserted = editor.value.slice(prefix, editor.value.length - suffix);
  const result = applyMultiEdit(original.value, original.positions, "insert", inserted);
  if (!result) return;
  editor.value = result.value;
  editor.setSelectionRange(result.positions[0], result.positions[0]);
  state.secondaryCursors = result.positions.slice(1);
  renderSecondaryCursors();
  editor.dispatchEvent(new Event("input", { bubbles: true }));
});
$("editor").addEventListener("keydown", (event) => {
  const editor = event.currentTarget;
  if ((event.ctrlKey || event.metaKey) && !event.altKey &&
    (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
    event.preventDefault();
    restoreEditorHistory(event.key.toLowerCase() === "y" || event.shiftKey);
    return;
  }
  if (event.key === "Escape" && state.secondaryCursors.length) {
    event.preventDefault();
    clearSecondaryCursors();
    return;
  }
  if (state.secondaryCursors.length && !event.isComposing) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const actions = { Backspace: "backspace", Delete: "delete" };
    if (event.key === "Tab" || event.key === "Enter" || actions[event.key] ||
      event.key.length === 1) {
      event.preventDefault();
      applyMultiAction(event.key === "Tab" && event.shiftKey ? "outdent" :
        actions[event.key] || "insert",
      event.key === "Tab" ? "\t" : event.key === "Enter" ? "\n" : event.key);
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      if (event.shiftKey) { clearSecondaryCursors(); return; }
      event.preventDefault();
      const positions = [editor.selectionStart, ...state.secondaryCursors]
        .map((position) => moveCursor(editor.value, position, event.key));
      editor.setSelectionRange(positions[0], positions[0]);
      state.secondaryCursors = [...new Set(positions.slice(1))]
        .filter((position) => position !== positions[0]);
      renderSecondaryCursors();
      return;
    }
  }
  if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
  event.preventDefault();
  const change = editIndent(editor.value, editor.selectionStart, editor.selectionEnd, event.shiftKey);
  if (!change) return;
  const direction = editor.selectionDirection;
  editor.setRangeText(change.replacement, change.replaceStart, change.replaceEnd, "preserve");
  editor.setSelectionRange(change.selectionStart, change.selectionEnd, direction);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
});
$("encodingSelect").addEventListener("change", changeEncoding);
$("save").addEventListener("click", save);
$("saveAs").addEventListener("click", saveAs);
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
  }
});
window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
init();
