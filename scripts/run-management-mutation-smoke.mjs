import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { accountKey, testKey } from '../tests/e2e/fixtures/management-mutation-state.mjs';

// Inherit only OS/runtime settings; no .env file or service credential is loaded.
const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DISPLAY', 'XAUTHORITY', 'CI'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const userData = await mkdtemp(path.join(tmpdir(), 'orbit-mutation-smoke-'));
const isolated = { ...environment, NODE_ENV: 'test', ORBIT_FIRESTORE_MEMORY: 'true', ORBIT_API_URL: 'http://127.0.0.1:4185', ORBIT_CLIENT_API_KEY: testKey, ORBIT_CLIENT_ACCOUNT_KEY: accountKey, ORBIT_ALLOW_LEGACY_CLIENT_KEY: 'true', ORBIT_ENABLE_FIREBASE_SYNC: 'false', ORBIT_ENABLE_EMBEDDED_BACKEND: 'false', VITE_E2E_FIXTURE_MODE: 'true', VITE_ENABLE_FIREBASE_SYNC: 'false', VITE_ORBIT_LOCAL_API_URL: 'http://127.0.0.1:4185', TABLEMANAGER_USER_DATA_DIR: userData, ELECTRON_DEV: 'true' };
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
const waitFor = async url => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* wait for local startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Local service did not start: ' + url);
};
try {
  if (!process.argv.includes('--reuse-build')) await run(['node_modules/vite/bin/vite.js', 'build', '--config', 'tests/e2e/fixtures/management-mutation-vite.config.mjs'], { ...isolated, NODE_ENV: 'production' });
  launch(['tests/e2e/fixtures/management-mutation-api.mjs']);
  await waitFor('http://127.0.0.1:4185/health');
  launch(['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5173', '--strictPort', '--config', 'tests/e2e/fixtures/management-mutation-vite.config.mjs']);
  await waitFor('http://127.0.0.1:5173');
  await run(['tests/e2e/management-mutation-smoke.mjs']);
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
  const resolved = path.resolve(userData);
  if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(resolved).startsWith('orbit-mutation-smoke-')) throw new Error('Unexpected temporary directory.');
  await rm(resolved, { recursive: true, force: true });
}
