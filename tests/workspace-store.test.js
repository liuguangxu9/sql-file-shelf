const test = require('node:test');
const assert = require('node:assert/strict');
const { moveWorkspace, normalizeWorkspaces, removeWorkspace, selectWorkspace } = require('../src/workspace-store');

test('restores valid persisted workspaces and ignores malformed entries', () => {
  const workspaces = normalizeWorkspaces([
    { id: 'a', name: 'SQL', handle: { kind: 'directory' } },
    { id: 'b', name: 'Notes', handle: { kind: 'directory' } },
    { id: 'bad', name: 'Broken' },
  ]);
  assert.deepEqual(workspaces.map(({ id, name }) => ({ id, name })), [
    { id: 'a', name: 'SQL' }, { id: 'b', name: 'Notes' },
  ]);
});

test('removing the selected workspace selects the next available workspace', () => {
  const workspaces = normalizeWorkspaces([
    { id: 'a', name: 'SQL', handle: { kind: 'directory' } },
    { id: 'b', name: 'Notes', handle: { kind: 'directory' } },
  ]);
  const result = removeWorkspace(workspaces, 'a', 'a');
  assert.equal(result.activeId, 'b');
  assert.deepEqual(result.workspaces.map((workspace) => workspace.id), ['b']);
});

test('selectWorkspace only accepts an existing workspace id', () => {
  const workspaces = normalizeWorkspaces([{ id: 'a', name: 'SQL', handle: { kind: 'directory' } }]);
  assert.equal(selectWorkspace(workspaces, 'missing', 'a'), 'a');
  assert.equal(selectWorkspace(workspaces, 'a', null), 'a');
});

test('moves a workspace to the requested position without changing other entries', () => {
  const workspaces = normalizeWorkspaces([
    { id: 'a', name: 'SQL', handle: {} }, { id: 'b', name: 'Notes', handle: {} }, { id: 'c', name: 'Archive', handle: {} },
  ]);
  assert.deepEqual(moveWorkspace(workspaces, 'c', 'a').map((workspace) => workspace.id), ['c', 'a', 'b']);
});
