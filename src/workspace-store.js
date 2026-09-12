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

function moveWorkspace(workspaces, movingId, beforeId) {
  const moving = workspaces.find((workspace) => workspace.id === movingId);
  if (!moving || movingId === beforeId) return workspaces;
  const remaining = workspaces.filter((workspace) => workspace.id !== movingId);
  const index = remaining.findIndex((workspace) => workspace.id === beforeId);
  remaining.splice(index < 0 ? remaining.length : index, 0, moving);
  return remaining;
}

module.exports = { moveWorkspace, normalizeWorkspaces, removeWorkspace, selectWorkspace };
