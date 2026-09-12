function filterFiles(files, query) {
  const term = String(query || '').trim().toLocaleLowerCase();
  return [...files]
    .filter((file) => !term || [file.name, file.path, file.extension].some((value) => String(value || '').toLocaleLowerCase().includes(term)))
    .sort((left, right) => (right.modified || 0) - (left.modified || 0) || left.path.localeCompare(right.path, 'zh-CN'));
}

function formatFileTime(timestamp) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

module.exports = { filterFiles, formatFileTime };
