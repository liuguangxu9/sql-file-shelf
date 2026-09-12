const browserify = require('browserify');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src');
const output = path.join(root, 'dist');

fs.mkdirSync(output, { recursive: true });
browserify(path.join(source, 'app.js')).bundle((error, buffer) => {
  if (error) throw error;
  fs.writeFileSync(path.join(output, 'app.js'), buffer);
  for (const file of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    fs.copyFileSync(path.join(source, file), path.join(output, file));
  }
  console.log('Built static PWA into dist/.');
});
