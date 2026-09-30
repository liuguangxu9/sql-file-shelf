const codec = require("./codec");
let worker;
let sequence = 0;
const pending = new Map();
function decodeAsync(bytes) {
  if (typeof Worker === "undefined") {
    const metadata = codec.detectEncoding(bytes);
    const text = codec.decodeFileBytes(bytes, metadata);
    return Promise.resolve({ metadata, text, newline: codec.detectNewline(text) });
  }
  if (!worker) {
    worker = new Worker("./codec-worker.js?v=21");
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      pending.delete(data.id);
      if (data.error) task.reject(new Error(data.error));
      else task.resolve(data);
    };
    worker.onerror = () => {
      for (const task of pending.values()) task.reject(new Error("编码处理未能启动，请刷新页面后重试。"));
      pending.clear();
      worker.terminate();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    // Keep original bytes on the page for lossless saves and conflict detection.
    worker.postMessage({ id, bytes });
  });
}
module.exports = { decodeAsync };
