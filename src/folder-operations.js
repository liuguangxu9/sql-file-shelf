const { readBytes, writeBytes, sameBytes } = require('./file-operations');
const { validateFolderName } = require('./file-model');

// A sibling-only rename inside an already-authorized directory. No recursive delete.
async function renameDirectory(parent, oldName, newName, progress = () => {}) {
  const validated = validateFolderName(newName);
  if (!validated.valid) throw new Error(validated.error);
  newName = validated.name;
  if (oldName === newName) return parent.getDirectoryHandle(oldName);
  const source = await parent.getDirectoryHandle(oldName);
  for await (const [name] of parent.entries()) {
    if (name.toLocaleLowerCase() === newName.toLocaleLowerCase())
      throw new Error(`“${newName}”已存在，不能覆盖。`);
  }
  let targetCreated = false;
  const records = [];
  const folders = [];
  try {
    const destination = await parent.getDirectoryHandle(newName, { create: true });
    targetCreated = true;
    for await (const _ of destination.values()) throw new Error('目标目录已被占用。');
    async function copy(from, to, owner, name, path) {
      folders.push({from, to, owner, name, path});
      for await (const [childName, handle] of from.entries()) {
        const childPath = path ? `${path}/${childName}` : childName;
        if (handle.kind === 'directory') {
          const child = await to.getDirectoryHandle(childName, { create: true });
          await copy(handle, child, from, childName, childPath);
        } else {
          const bytes = await readBytes(handle);
          const target = await to.getFileHandle(childName, { create: true });
          if ((await readBytes(target)).length) throw new Error('目标文件在复制期间出现。');
          await writeBytes(target, bytes);
          if (!sameBytes(bytes, await readBytes(target))) throw new Error(`复制校验失败：${childPath}`);
          records.push({ source:handle, target, parent:from, name:childName, path:childPath });
          progress(records.length);
        }
      }
    }
    await copy(source, destination, parent, oldName, '');
    // Check every original against its verified copy before removing anything.
    for (const record of records) {
      if (!sameBytes(await readBytes(record.source), await readBytes(record.target)))
        throw new Error(`原文件在复制期间发生变化：${record.path}`);
    }
    const copiedPaths = new Set([...records.map(r=>`f:${r.path}`), ...folders.slice(1).map(r=>`d:${r.path}`)]);
    async function checkInventory(dir, path = '') {
      for await (const [name, handle] of dir.entries()) {
        const relative = path ? `${path}/${name}` : name;
        if (!copiedPaths.has(`${handle.kind === 'directory' ? 'd' : 'f'}:${relative}`))
          throw new Error(`原目录在复制期间出现新内容：${relative}`);
        if (handle.kind === 'directory') await checkInventory(handle, relative);
      }
    }
    await checkInventory(source);
    // Recheck each pair immediately before removing that original. New/changed content is retained.
    for (const record of records) {
      if (!sameBytes(await readBytes(record.source), await readBytes(record.target)))
        throw new Error(`原文件在迁移期间发生变化：${record.path}`);
      await record.parent.removeEntry(record.name);
    }
    for (const folder of folders.reverse()) {
      for await (const _ of folder.from.values()) throw new Error('原目录出现了新内容，已停止迁移。');
      await folder.owner.removeEntry(folder.name, { recursive: false });
    }
    return destination;
  } catch (error) {
    if (targetCreated) error.message += `。操作已停止，请保留并检查“${oldName}”与“${newName}”两处内容。`;
    throw error;
  }
}

const isWithin = (path, folder) => path === folder || path.startsWith(`${folder}/`);
const renamedPath = (path, from, to) => isWithin(path, from) ? to + path.slice(from.length) : path;
module.exports = { renameDirectory, isWithin, renamedPath };
