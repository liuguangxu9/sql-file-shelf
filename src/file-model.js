function filterFiles(
  files,
  query,
  sort = { key: "modified", direction: "desc" },
) {
  const term = String(query || "")
    .trim()
    .toLocaleLowerCase();
  const multiplier = sort.direction === "asc" ? 1 : -1;
  return [...files]
    .filter(
      (file) =>
        !term ||
        [file.name, file.path, file.extension].some((value) =>
          String(value || "")
            .toLocaleLowerCase()
            .includes(term),
        ),
    )
    .sort((left, right) => {
      const a =
        sort.key === "modified"
          ? left.modified || 0
          : String(left[sort.key] || "");
      const b =
        sort.key === "modified"
          ? right.modified || 0
          : String(right[sort.key] || "");
      const comparison =
        typeof a === "number" ? a - b : a.localeCompare(b, "zh-CN");
      return (
        comparison * multiplier || left.path.localeCompare(right.path, "zh-CN")
      );
    });
}

function formatFileTime(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function buildFileTree(folders, entries, options = {}) {
  const parentPath = (path) => {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? "" : path.slice(0, slash);
  };
  const paths = new Set(folders.map((folder) => folder.path));
  const scope = paths.has(options.scope) ? options.scope : "";
  const withinScope = (path) =>
    !scope || path === scope || path.startsWith(`${scope}/`);
  const scopedFiles = entries.filter((entry) => withinScope(entry.path));
  const query = String(options.query || "").trim();
  const matches = filterFiles(scopedFiles, query, options.sort);
  const included = new Set([scope]);
  if (query) {
    const term = query.toLocaleLowerCase();
    for (const folder of folders) {
      if (withinScope(folder.path) && folder.path.toLocaleLowerCase().includes(term))
        included.add(folder.path);
    }
    for (const entry of matches) {
      let parent = parentPath(entry.path);
      while (withinScope(parent)) {
        included.add(parent);
        if (parent === scope) break;
        parent = parentPath(parent);
      }
    }
    for (const path of [...included]) {
      let parent = parentPath(path);
      while (withinScope(parent)) {
        included.add(parent);
        if (parent === scope) break;
        parent = parentPath(parent);
      }
    }
  }
  const folderChildren = new Map();
  for (const folder of folders) {
    if (folder.path === scope || !withinScope(folder.path)) continue;
    if (query && !included.has(folder.path)) continue;
    const parent = parentPath(folder.path);
    if (!folderChildren.has(parent)) folderChildren.set(parent, []);
    folderChildren.get(parent).push(folder);
  }
  for (const children of folderChildren.values())
    children.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
  const fileChildren = new Map();
  for (const entry of matches) {
    const parent = parentPath(entry.path);
    if (!fileChildren.has(parent)) fileChildren.set(parent, []);
    fileChildren.get(parent).push(entry);
  }
  const expanded = new Set(options.expanded || [""]);
  const rows = [];
  function visit(folder, depth) {
    rows.push({ kind: "folder", path: folder.path, depth, folder });
    if (!query && !expanded.has(folder.path)) return;
    for (const child of folderChildren.get(folder.path) || []) visit(child, depth + 1);
    for (const entry of fileChildren.get(folder.path) || [])
      rows.push({ kind: "file", path: entry.path, depth: depth + 1, entry });
  }
  const root = folders.find((folder) => folder.path === scope) || { path: "" };
  if (options.hideRoot && scope === "") {
    for (const child of folderChildren.get("") || []) visit(child, 0);
    for (const entry of fileChildren.get("") || [])
      rows.push({ kind: "file", path: entry.path, depth: 0, entry });
  } else {
    visit(root, 0);
  }
  return { rows, count: matches.length };
}

function validateNewFileName(value) {
  const name = String(value || "").trim();
  const filename = name && !name.includes(".") ? `${name}.sql` : name;
  if (
    !filename ||
    filename === "." ||
    filename === ".." ||
    filename.lastIndexOf(".") === 0 ||
    /[\\/:*?"<>|]/.test(filename) ||
    !/\.(sql|txt|md)$/i.test(filename)
  ) {
    return {
      valid: false,
      error: "文件名必须位于工作区根目录，并以 .sql、.txt 或 .md 结尾。",
    };
  }
  return { valid: true, name: filename };
}

function validateFolderName(value) {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|]/.test(name))
    return { valid: false, error: "目录名不能为空，且不能包含路径或文件系统保留字符。" };
  return { valid: true, name };
}

module.exports = { filterFiles, formatFileTime, buildFileTree, validateNewFileName, validateFolderName };
