function normalizeWorkspaces(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.filter((workspace) => {
    if (!workspace || typeof workspace.id !== 'string' || !workspace.id || ids.has(workspace.id)
      || typeof workspace.name !== 'string' || !workspace.name || !workspace.handle) return false;
    ids.add(workspace.id);
    return true;
  });
}

function selectWorkspace(workspaces, candidateId, fallbackId = null) {
  return workspaces.some((workspace) => workspace.id === candidateId)
    ? candidateId
    : workspaces.some((workspace) => workspace.id === fallbackId)
      ? fallbackId
      : workspaces[0]?.id || null;
}

function removeWorkspace(workspaces, id, activeId) {
  const remaining = workspaces.filter((workspace) => workspace.id !== id);
  return { workspaces: remaining, activeId: selectWorkspace(remaining, activeId) };
}

module.exports = { normalizeWorkspaces, removeWorkspace, selectWorkspace };
