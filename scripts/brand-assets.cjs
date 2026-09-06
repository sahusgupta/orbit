const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const exportsBySource = new Map([
  ['public/orbit-logo.svg', ['download-site/orbit-logo.svg', 'apps/api/public/orbit-logo.svg', 'player-web/public/orbit-logo.svg']],
  ['public/orbit-icon.png', [
    'download-site/orbit-icon.png',
    'player-web/public/orbit-icon.png',
    'player-web/app/icon.png',
    'player-web/app/apple-icon.png'
  ]],
  ['build/icon.ico', ['player-web/app/favicon.ico']],
  ['build/icon.png', [
    'player-app/assets/icon.png',
    'player-app/assets/adaptive-icon.png'
  ]]
]);

function absolute(relativePath) {
  return path.join(repositoryRoot, ...relativePath.split('/'));
}

function digest(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function synchronize() {
  for (const [source, outputs] of exportsBySource) {
    for (const output of outputs) fs.copyFileSync(absolute(source), absolute(output));
  }
}

function check() {
  const drift = [];
  for (const [source, outputs] of exportsBySource) {
    const sourceDigest = digest(absolute(source));
    for (const output of outputs) {
      if (!fs.existsSync(absolute(output)) || digest(absolute(output)) !== sourceDigest) {
        drift.push(`${output} must be exported from ${source}`);
      }
    }
  }
  if (drift.length) throw new Error(`Orbit brand asset drift:\n${drift.join('\n')}`);
  return [...exportsBySource.values()].flat().length;
}

if (require.main === module) {
  if (process.argv.includes('--write')) synchronize();
  const count = check();
  console.log(`Orbit brand assets verified: ${count} governed exports.`);
}

module.exports = { check, exportsBySource, synchronize };
