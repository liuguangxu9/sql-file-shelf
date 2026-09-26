const codec = require("./codec");
const store = require("./workspace-store");
const files = require("./file-model");
const operations = require("./file-operations");
const ACCEPTED = new Set(["sql", "txt", "md"]);
const state = {
  workspaces: [],
  activeWorkspaceId: null,
  fileCache: new Map(),
  folderCache: new Map(),
  active: null,
  dirty: false,
  globalTimer: null,
  fileSort: { key: "modified", direction: "desc" },
  draggingWorkspaceId: null,
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
  if (!active) return;
  $("encoding").textContent = active.metadata.encoding.toUpperCase();
  $("bom").textContent = active.metadata.bom
    ? active.metadata.bom.toUpperCase()
    : "无";
  $("newline").textContent =
    active.newline === "crlf" ? "CRLF" : active.newline === "cr" ? "CR" : "LF";
  $("encodingSelect").value = active.metadata.encoding;
}

async function walk(directory, path = "", folders = []) {
  const result = [];
  for await (const [, handle] of directory.entries()) {
    const relative = path ? `${path}/${handle.name}` : handle.name;
    if (handle.kind === "directory") {
      folders.push({ path: relative, handle });
      result.push(...(await walk(handle, relative, folders)));
    }
    if (handle.kind === "file" && ACCEPTED.has(extension(handle.name))) {
      const file = await handle.getFile();
      result.push({
        name: handle.name,
        path: relative,
        extension: extension(handle.name),
        modified: file.lastModified,
        handle,
        parent: directory,
      });
    }
  }
  return result;
}

async function scanWorkspace(workspace) {
  if (!workspace || !(await permission(workspace.handle))) return [];
  const folders = [{ path: "", handle: workspace.handle }];
  const result = await walk(workspace.handle, "", folders);
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
  if (state.dirty && !confirm("当前文件尚未保存，仍要切换工作区吗？")) return;
  state.activeWorkspaceId = id;
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
  if (
    !workspace ||
    !confirm(`从工具中移除“${workspace.name}”？本地文件不会删除。`)
  )
    return;
  const result = store.removeWorkspace(
    state.workspaces,
    id,
    state.activeWorkspaceId,
  );
  state.workspaces = result.workspaces;
  state.activeWorkspaceId = result.activeId;
  state.fileCache.delete(id);
  state.folderCache.delete(id);
  if (state.active?.workspaceId === id) {
    state.active = null;
    $("editor").value = "";
    $("editor").disabled = true;
    markDirty(false);
    updateEditorInfo();
  }
  await persist();
  await render();
}

async function openFile(workspaceId, entry) {
  try {
    if (state.dirty && !confirm("当前文件尚未保存，仍要打开其他文件吗？"))
      return;
    const bytes = await operations.readBytes(entry.handle);
    const metadata = codec.detectEncoding(bytes);
    const text = codec.decodeFileBytes(bytes, metadata);
    state.active = {
      workspaceId,
      ...entry,
      metadata,
      newline: codec.detectNewline(text),
      originalBytes: bytes,
    };
    $("editor").value = text;
    $("editor").disabled = false;
    renderEditorDecorations();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    $("fileTitle").textContent = entry.name;
    $("filePath").textContent = `${workspace.name} / ${entry.path}`;
    markDirty(false);
    updateEditorInfo();
    await renderFiles();
  } catch (error) {
    setStatus(`无法打开文件：${error.message}`, true);
  }
}

async function newFile() {
  const workspace = current();
  if (!workspace) return setStatus("请先选择一个工作区。", true);
  if (!(await permission(workspace.handle)))
    return setStatus(`“${workspace.name}”尚未获得访问授权。`, true);
  const folder = selectedFolder(workspace);
  const requestedName = prompt(
    `新建文件（保存到 ${folder.path || "工作区根目录"}）：`,
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
    (folder) => folder.path === $("directorySelect").value,
  ) || { path: "", handle: workspace.handle };
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
    renderDirectorySelect();
    $("directorySelect").value = path;
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
      state.active = null;
      $("editor").value = "";
      $("editor").disabled = true;
      markDirty(false);
      updateEditorInfo();
    }
    await scanWorkspace(workspace);
    await render();
    setStatus(`已删除 ${entry.path}。`);
  } catch (error) {
    setStatus(`删除失败：${error.message}`, true);
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
  list.replaceChildren();
  $("workspaceCount").textContent = `${state.workspaces.length} 个`;
  $("workspaceSummary").textContent = state.workspaces.length
    ? `已记住 ${state.workspaces.length} 个工作区`
    : "新增一个本地目录作为工作区";
  for (const item of state.workspaces) {
    const row = document.createElement("div");
    row.className = "workspace";
    const pick = document.createElement("button");
    pick.textContent = `⋮⋮  ${item.name}`;
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
    list.append(row);
    if (!(await permission(item.handle))) {
      const grant = document.createElement("button");
      grant.className = "grant";
      grant.textContent = "恢复此目录访问";
      grant.addEventListener("click", () => requestAccess(item.id));
      list.append(grant);
    }
  }
  if (!state.workspaces.length)
    list.innerHTML =
      '<div class="placeholder">点击“新增工作区”，可逐个添加你的分类目录。</div>';
}

function renderDirectorySelect() {
  const select = $("directorySelect");
  const previous = select.value;
  select.replaceChildren();
  const workspace = current();
  for (const folder of state.folderCache.get(workspace?.id) || []) {
    const option = document.createElement("option");
    option.value = folder.path;
    option.textContent = folder.path || "工作区根目录";
    select.append(option);
  }
  select.value = previous;
  if (select.selectedIndex < 0) select.selectedIndex = 0;
  select.disabled = !workspace || !select.options.length;
}

async function renderFiles() {
  renderDirectorySelect();
  const body = $("fileList");
  body.replaceChildren();
  const workspace = current();
  const all = workspace ? state.fileCache.get(workspace.id) || [] : [];
  const visible = files.filterFiles(all, $("fileSearch").value, state.fileSort);
  $("fileCount").textContent = `${visible.length} 个`;
  $("fileEmpty").hidden = Boolean(visible.length);
  updateSortHeaders();
  for (const entry of visible) {
    const row = document.createElement("tr");
    if (state.active?.handle === entry.handle) row.className = "active";
    row.addEventListener("click", () => openFile(workspace.id, entry));
    const name = document.createElement("td");
    name.className = "name";
    name.title = entry.path;
    const content = document.createElement("div");
    content.className = "fileNameCell";
    const label = document.createElement("span");
    label.className = "fileNameText";
    label.textContent = entry.path;
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
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteFile(entry);
    });
    content.append(label, editLocation, remove);
    name.append(content);
    const time = document.createElement("td");
    time.className = "time";
    time.textContent = files.formatFileTime(entry.modified);
    const type = document.createElement("td");
    type.className = "type";
    type.textContent = entry.extension;
    row.append(name, time, type);
    body.append(row);
  }
}

function updateSortHeaders() {
  const labels = { name: "文件名", modified: "修改时间", extension: "格式" };
  for (const [key, label] of Object.entries(labels)) {
    const header = document.querySelector(
      `.fileTable th.${key === "modified" ? "time" : key === "extension" ? "type" : "name"}`,
    );
    header.textContent = `${label}${state.fileSort.key === key ? (state.fileSort.direction === "asc" ? " ↑" : " ↓") : " ↕"}`;
  }
}
function sortFiles(key) {
  state.fileSort = {
    key,
    direction:
      state.fileSort.key === key && state.fileSort.direction === "asc"
        ? "desc"
        : "asc",
  };
  renderFiles();
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
      if (state.activeWorkspaceId !== workspace.id) {
        state.activeWorkspaceId = workspace.id;
        await persist();
      }
      await openFile(workspace.id, entry);
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
  $("editor").value = text;
  $("fileTitle").textContent = name;
  $("filePath").textContent = `${owner.name} / ${path}`;
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

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function highlightSql(text) {
  const tokens =
    /(--[^\r\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*'|"(?:""|[^"])*")|\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|INSERT|INTO|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|VIEW|AS|AND|OR|NOT|NULL|IS|IN|LIKE|ORDER|BY|GROUP|HAVING|LIMIT|CASE|WHEN|THEN|ELSE|END|VALUES|SET|DISTINCT|UNION|ALL)\b|\b(\d+(?:\.\d+)?)\b/gi;
  return text.replace(
    tokens,
    (match, comment, string, keyword, number) =>
      `<span class="${comment ? "sql-comment" : string ? "sql-string" : keyword ? "sql-keyword" : "sql-number"}">${escapeHtml(match)}</span>`,
  );
}
function renderEditorDecorations() {
  const editor = $("editor");
  const text = editor.value;
  $("lineNumbers").textContent = Array.from(
    { length: Math.max(1, text.split("\n").length) },
    (_, index) => index + 1,
  ).join("\n");
  $("highlightCode").innerHTML =
    state.active?.extension === "sql" ? highlightSql(text) : escapeHtml(text);
}
function setupEditorChrome() {
  const editor = $("editor");
  const shell = document.createElement("div");
  shell.className = "editorShell";
  const lines = document.createElement("pre");
  lines.id = "lineNumbers";
  lines.className = "lineNumbers";
  const highlight = document.createElement("pre");
  highlight.id = "highlight";
  highlight.className = "highlight";
  const code = document.createElement("code");
  code.id = "highlightCode";
  highlight.append(code);
  editor.parentElement.insertBefore(shell, editor);
  shell.append(lines, highlight, editor);
  editor.addEventListener("scroll", () => {
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
    lines.scrollTop = editor.scrollTop;
  });
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
document
  .querySelector(".fileTable th.name")
  .addEventListener("click", () => sortFiles("name"));
document
  .querySelector(".fileTable th.time")
  .addEventListener("click", () => sortFiles("modified"));
document
  .querySelector(".fileTable th.type")
  .addEventListener("click", () => sortFiles("extension"));
$("addWorkspace").addEventListener("click", addWorkspace);
$("refreshFiles").addEventListener("click", refreshCurrentWorkspace);
$("newFile").addEventListener("click", newFile);
$("newFolder").addEventListener("click", newFolder);
$("fileSearch").addEventListener("input", renderFiles);
$("globalSearch").addEventListener("input", () => {
  clearTimeout(state.globalTimer);
  state.globalTimer = setTimeout(renderGlobalSearch, 250);
});
$("editor").addEventListener("input", () => {
  markDirty(true);
  renderEditorDecorations();
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
