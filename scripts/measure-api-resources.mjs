import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = { samples: 5, output: null, scenario: 'all' };
for (let index = 0; index < args.length; index += 1) {
  const value = args[index + 1];
  if (args[index] === '--samples' && /^\d+$/.test(value || '') && Number(value) >= 1 && Number(value) <= 25) options.samples = Number(value);
  else if (args[index] === '--output' && value) options.output = value;
  else if (args[index] === '--scenario' && ['all', 'discovery', 'publication'].includes(value)) options.scenario = value;
  else throw new Error('Usage: node scripts/measure-api-resources.mjs [--samples 1..25] [--scenario all|discovery|publication] [--output out/path.json]');
  index += 1;
}
let outputPath;
function rejectLinkedOutputDirectories(filename) {
  const pieces = path.relative(root, path.dirname(filename)).split(path.sep);
  let current = root;
  for (const piece of pieces) {
    current = path.join(current, piece);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('Measurement output must not traverse a symlink or junction.');
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}
if (options.output) {
  outputPath = path.resolve(root, options.output);
  const relative = path.relative(path.join(root, 'out'), outputPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(outputPath) !== '.json') {
    throw new Error('Measurement output must be a .json file beneath this repository\'s out/ directory.');
  }
  rejectLinkedOutputDirectories(outputPath);
}
const names = ['PATH', 'Path', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
const environment = Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
Object.assign(environment, {
  NODE_ENV: 'test', TZ: 'UTC', CI: '1', ORBIT_RESOURCE_BASELINE_CHILD: 'true',
  ORBIT_FIRESTORE_MEMORY: 'true', ORBIT_API_URL: 'http://127.0.0.1:9',
  ORBIT_ENABLE_FIREBASE_SYNC: 'false', VITE_ENABLE_FIREBASE_SYNC: 'false', ORBIT_ENABLE_EMBEDDED_BACKEND: 'false'
});
const result = spawnSync(process.execPath, ['--expose-gc', path.join(root, 'scripts/resource-baseline/worker.cjs'), String(options.samples), options.scenario], {
  cwd: root, env: environment, encoding: 'utf8', windowsHide: true, timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024
});
if (result.error || result.status !== 0) {
  if (result.stderr) process.stderr.write(result.stderr);
  throw new Error(`Isolated resource baseline failed (${result.error?.code || result.status}).`);
}
const report = JSON.parse(result.stdout);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  rejectLinkedOutputDirectories(outputPath);
  writeFileSync(outputPath, serialized, { flag: 'wx' });
}
process.stdout.write(serialized);
