const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'release');
const downloadDir = path.join(root, 'download-site', 'public', 'downloads');
const manifestPath = path.join(downloadDir, 'manifest.json');
const packageJson = require(path.join(root, 'package.json'));

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function latestMatching(files, predicate) {
  return files
    .filter(predicate)
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
}

function copyArtifact(artifact, outputName) {
  if (!artifact) return null;
  fs.copyFileSync(artifact.filePath, path.join(downloadDir, outputName));
  return {
    fileName: outputName,
    originalName: path.basename(artifact.filePath),
    sizeBytes: artifact.stat.size,
    updatedAt: artifact.stat.mtime.toISOString()
  };
}

fs.mkdirSync(downloadDir, { recursive: true });
for (const entry of fs.readdirSync(downloadDir)) {
  fs.rmSync(path.join(downloadDir, entry), { recursive: true, force: true });
}

const files = walkFiles(releaseDir);
const installer = latestMatching(files, (filePath) => /\.exe$/i.test(path.basename(filePath)) && !/blockmap$/i.test(filePath));
const zip = latestMatching(files, (filePath) => /\.zip$/i.test(path.basename(filePath)));

if (!installer && !zip) {
  throw new Error('No electron-builder artifacts found. Run `npm run make` before staging the download site.');
}

const manifest = {
  productName: 'Orbit',
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  installer: copyArtifact(installer, 'Orbit-Setup.exe'),
  zip: copyArtifact(zip, 'Orbit-Windows-x64.zip')
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Staged download site assets in ${downloadDir}`);
