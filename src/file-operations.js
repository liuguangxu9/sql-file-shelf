async function readBytes(handle) {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

function sameBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

async function writeBytes(handle, bytes) {
  const writer = await handle.createWritable();
  await writer.write(bytes);
  await writer.close();
}

async function findFile(directory, name) {
  try {
    return await directory.getFileHandle(name);
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

async function relocateFile(entry, destination, name) {
  if (await findFile(destination, name))
    throw new Error(`目标文件“${name}”已存在。`);
  const original = await readBytes(entry.handle);
  const target = await destination.getFileHandle(name, { create: true });
  if ((await readBytes(target)).length)
    throw new Error(`目标文件“${name}”在操作期间出现，原文件仍在。`);
  await writeBytes(target, original);
  if (!sameBytes(original, await readBytes(target)))
    throw new Error("目标文件校验失败；原文件仍在，目标文件可能需要手动清理。");
  if (!sameBytes(original, await readBytes(entry.handle)))
    throw new Error("原文件在移动过程中被修改；原文件仍在，目标副本需要手动检查。");
  await entry.parent.removeEntry(entry.name);
  return target;
}

module.exports = { readBytes, sameBytes, writeBytes, findFile, relocateFile };
