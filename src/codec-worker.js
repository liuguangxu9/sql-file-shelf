const codec = require("./codec");
self.onmessage = ({ data: { id, bytes } }) => {
  try {
    const metadata = codec.detectEncoding(bytes);
    const text = codec.decodeFileBytes(bytes, metadata);
    self.postMessage({ id, metadata, text, newline: codec.detectNewline(text) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
