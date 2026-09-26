const test = require("node:test");
const assert = require("node:assert/strict");
const { readBytes, sameBytes, findFile, relocateFile } = require("../src/file-operations");

function directory() {
  const entries = new Map();
  return {
    entries,
    async getFileHandle(name, options = {}) {
      if (!entries.has(name) && !options.create)
        throw Object.assign(new Error("Missing"), { name: "NotFoundError" });
      if (!entries.has(name)) entries.set(name, new Uint8Array());
      return {
        name,
        async getFile() {
          const bytes = entries.get(name);
          return { arrayBuffer: async () => bytes.slice().buffer };
        },
        async createWritable() {
          let pending;
          return {
            async write(bytes) { pending = new Uint8Array(bytes); },
            async close() { entries.set(name, pending); },
          };
        },
      };
    },
    async removeEntry(name) { entries.delete(name); },
  };
}

test("detects changed bytes even when the filename is unchanged", async () => {
  const folder = directory();
  folder.entries.set("a.sql", new Uint8Array([1, 2]));
  const handle = await folder.getFileHandle("a.sql");
  const opened = await readBytes(handle);
  folder.entries.set("a.sql", new Uint8Array([1, 3]));
  assert.equal(sameBytes(opened, await readBytes(handle)), false);
});

test("relocates only after copy verification and preserves the source on name conflict", async () => {
  const source = directory();
  const destination = directory();
  source.entries.set("a.sql", new Uint8Array([1, 2, 3]));
  const entry = { name: "a.sql", handle: await source.getFileHandle("a.sql"), parent: source };
  destination.entries.set("b.sql", new Uint8Array([9]));
  await assert.rejects(relocateFile(entry, destination, "b.sql"), /已存在/);
  assert.deepEqual([...source.entries.get("a.sql")], [1, 2, 3]);
  await relocateFile(entry, destination, "c.sql");
  assert.equal(await findFile(source, "a.sql"), null);
  assert.deepEqual([...destination.entries.get("c.sql")], [1, 2, 3]);
});

test("keeps the source when the copied bytes do not verify", async () => {
  const source = directory();
  const destination = directory();
  source.entries.set("a.sql", new Uint8Array([4, 5]));
  const entry = { name: "a.sql", handle: await source.getFileHandle("a.sql"), parent: source };
  const originalGetFileHandle = destination.getFileHandle.bind(destination);
  destination.getFileHandle = async (name, options) => {
    const handle = await originalGetFileHandle(name, options);
    if (!options?.create) return handle;
    handle.createWritable = async () => ({
      async write() {},
      async close() { destination.entries.set(name, new Uint8Array([0])); },
    });
    return handle;
  };
  await assert.rejects(relocateFile(entry, destination, "b.sql"), /校验失败/);
  assert.deepEqual([...source.entries.get("a.sql")], [4, 5]);
});
