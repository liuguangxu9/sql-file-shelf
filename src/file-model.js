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

function validateNewFileName(value) {
  const name = String(value || "").trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/]/.test(name) ||
    !/\.(sql|txt|md)$/i.test(name)
  ) {
    return {
      valid: false,
      error: "文件名必须位于工作区根目录，并以 .sql、.txt 或 .md 结尾。",
    };
  }
  return { valid: true, name };
}

module.exports = { filterFiles, formatFileTime, validateNewFileName };
