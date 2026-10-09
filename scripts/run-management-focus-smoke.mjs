import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { accountKey, testKey } from '../tests/e2e/fixtures/management-mutation-state.mjs';

// Neither developer .env files nor inherited service credentials enter this run.
const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DISPLAY', 'XAUTHORITY', 'CI'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const userData = await mkdtemp(path.join(tmpdir(), 'orbit-focus-smoke-'));
const isolated = { ...environment, NODE_ENV: 'test', ORBIT_FIRESTORE_MEMORY: 'true', ORBIT_API_URL: 'http://127.0.0.1:4185', ORBIT_CLIENT_API_KEY: testKey, ORBIT_CLIENT_ACCOUNT_KEY: accountKey, ORBIT_ALLOW_LEGACY_CLIENT_KEY: 'true', ORBIT_ENABLE_FIREBASE_SYNC: 'false', ORBIT_ENABLE_EMBEDDED_BACKEND: 'false', VITE_E2E_FIXTURE_MODE: 'true', VITE_ENABLE_FIREBASE_SYNC: 'false', VITE_ORBIT_LOCAL_API_URL: 'http://127.0.0.1:4185', TABLEMANAGER_USER_DATA_DIR: userData, ELECTRON_DEV: 'true', ORBIT_FOCUS_RUNTIME: process.argv.includes('--browser') ? 'browser' : 'electron' };
const buildReceiptPath = path.join(process.cwd(), 'dist', '.orbit-focus-isolated-build.json');
const buildReceipt = { fixtureMode: 'true', firebaseSync: 'false', apiUrl: 'http://127.0.0.1:4185', envDir: false };
const reuseBuild = process.argv.includes('--reuse-build');
const children = [];
const launch = (args, env = isolated) => {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  return child;
};
const run = (args, env = isolated) => new Promise((resolve, reject) => {
  const child = launch(args, env);
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(args.join(' ') + ' exited ' + code)));
});
const assertPortAvailable = port => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', () => reject(new Error('Refusing to reuse a service already listening on local port ' + port)));
  probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});
const waitFor = async url => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* local startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Local service did not start: ' + url);
};
try {
  // VITE flags are baked into dist. Never launch a reused production bundle
  // with only runtime environment overrides; ordinary Vite builds clear this.
  if (reuseBuild) {
    let receipt;
    try { receipt = JSON.parse(await readFile(buildReceiptPath, 'utf8')); } catch { /* missing or invalid receipt */ }
    if (JSON.stringify(receipt) !== JSON.stringify(buildReceipt)) throw new Error('Refusing --reuse-build: an isolated focus build receipt is missing or does not match. Run without --reuse-build first.');
  }
  await assertPortAvailable(4185);
  await assertPortAvailable(5173);
  if (!reuseBuild) {
    await run(['node_modules/vite/bin/vite.js', 'build', '--config', 'tests/e2e/fixtures/management-mutation-vite.config.mjs'], { ...isolated, NODE_ENV: 'production' });
    await writeFile(buildReceiptPath, JSON.stringify(buildReceipt) + '\n', 'utf8');
  }
  launch(['tests/e2e/fixtures/management-focus-api.mjs']);
  await waitFor('http://127.0.0.1:4185/health');
  launch(['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5173', '--strictPort', '--config', 'tests/e2e/fixtures/management-mutation-vite.config.mjs']);
  await waitFor('http://127.0.0.1:5173');
  await run(['tests/e2e/management-focus-smoke.mjs']);
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
  const resolved = path.resolve(userData);
  if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(resolved).startsWith('orbit-focus-smoke-')) throw new Error('Unexpected temporary directory.');
  await rm(resolved, { recursive: true, force: true });
}
