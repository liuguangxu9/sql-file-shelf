const browserify = require('browserify');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src');
const output = path.join(root, 'dist');

const crypto = require('node:crypto');
const vendor = path.join(root, 'vendor/workbench');
const framework = JSON.parse(fs.readFileSync(path.join(vendor, 'manifest.json'), 'utf8'));
for (const [name, hash] of Object.entries(framework.files)) {
  const bytes = fs.readFileSync(path.join(vendor, name));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Framework snapshot changed: ${name}; export a verified framework version`);
}
const swSource = fs.readFileSync(path.join(source, 'sw.js'), 'utf8');
const offlineList = swSource.match(/const ASSETS = (\[[\s\S]*?\]);/)[1];
const offlineAssets = new Set([...offlineList.matchAll(/'([^']+)'/g)].map(match => match[1]));
const page = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
const resourceURLs = [...page.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map(match => match[1]);
const workerURL = fs.readFileSync(path.join(source, 'async-codec.js'), 'utf8').match(/new Worker\("([^"]+)"\)/)[1];
for (const url of [...resourceURLs, workerURL]) {
  if (!offlineAssets.has(url)) throw new Error(`Offline shell is missing ${url}`);
}
fs.mkdirSync(output, { recursive: true });
browserify(path.join(source, 'codec-worker.js')).bundle((error, buffer) => {
  if (error) throw error;
  fs.writeFileSync(path.join(output, 'codec-worker.js'), buffer);
});
browserify(path.join(source, 'app.js')).bundle((error, buffer) => {
  if (error) throw error;
  fs.writeFileSync(path.join(output, 'app.js'), buffer);
  for (const file of ['index.html', 'app.css', 'favicon.png', 'manifest.webmanifest', 'sw.js']) {
    fs.copyFileSync(path.join(source, file), path.join(output, file));
  }
  fs.copyFileSync(path.join(vendor, 'workbench.css'), path.join(output, 'workbench.css'));
  console.log('Built static PWA into dist/.');
});
