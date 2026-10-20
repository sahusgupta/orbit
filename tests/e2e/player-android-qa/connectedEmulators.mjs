import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertInside, repositoryRoot } from './prepare.mjs';
import { connectedRoot } from './connectedPrepare.mjs';
import { assertConnectedTarget, fixedConnectedTarget } from './connectedServer.mjs';

export const emulatorControlPorts = Object.freeze({ hub: 14400, logging: 14500, websocket: 18150 });
const emulatorRoot = path.join(connectedRoot, 'emulators');
const firestoreJarName = 'cloud-firestore-emulator-v1.22.0.jar';
const firestoreJarDigest = '9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c';
const osKeys = ['Path', 'PATH', 'SystemRoot', 'SystemDrive', 'ComSpec', 'PATHEXT', 'OS', 'WINDIR', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'];

export function createEmulatorEnvironment(host = process.env) {
  const env = Object.fromEntries(osKeys.filter(key => typeof host[key] === 'string').map(key => [key, host[key]]));
  const userHome = path.join(emulatorRoot, 'user-home');
  const javaHome = 'C:/Program Files/Android/Android Studio/jbr';
  const originalPath = env.Path ?? env.PATH ?? '';
  // Windows treats these names as equal; Node otherwise selects the sorted first key.
  delete env.Path;
  env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${originalPath}`;
  return Object.assign(env, {
    USERPROFILE: userHome, APPDATA: path.join(userHome, 'AppData/Roaming'), LOCALAPPDATA: path.join(userHome, 'AppData/Local'),
    TEMP: path.join(emulatorRoot, 'tmp'), TMP: path.join(emulatorRoot, 'tmp'), XDG_CONFIG_HOME: path.join(emulatorRoot, 'config'),
    XDG_DATA_HOME: path.join(emulatorRoot, 'data'), FIREBASE_EMULATORS_PATH: path.join(emulatorRoot, 'public-cache'),
    JAVA_HOME: javaHome, JAVA_TOOL_OPTIONS: `-Duser.home=${userHome}`,
    CI: '1', NO_UPDATE_NOTIFIER: '1', FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true', GCLOUD_PROJECT: fixedConnectedTarget.projectId,
    GOOGLE_CLOUD_PROJECT: fixedConnectedTarget.projectId
  });
}

export function connectedEmulatorConfiguration(target = fixedConnectedTarget) {
  assertConnectedTarget(target);
  return { firestore: { rules: './firestore.rules', indexes: './firestore.indexes.json' }, emulators: {
    firestore: { ...target.firestore, websocketPort: emulatorControlPorts.websocket }, auth: target.auth,
    hub: { host: '127.0.0.1', port: emulatorControlPorts.hub }, logging: { host: '127.0.0.1', port: emulatorControlPorts.logging },
    ui: { enabled: false }, singleProjectMode: true
  } };
}

export function emulatorNetworkGuardSource() {
  const ports = [fixedConnectedTarget.firestore.port, fixedConnectedTarget.auth.port, ...Object.values(emulatorControlPorts)];
  return `// QA CLI preload: no credentials or hosted requests; demo/loopback only.\nconst net = require('node:net'); const tls = require('node:tls'); const http2 = require('node:http2'); const dns = require('node:dns'); const dgram = require('node:dgram');\nconst ports = new Set(${JSON.stringify(ports)});\nconst valid = (host, port) => (host === '127.0.0.1' || host === 'localhost' || host === '::1') && ports.has(Number(port));\nconst originalConnect = net.Socket.prototype.connect;\nnet.Socket.prototype.connect = function (...args) { const a = Array.isArray(args[0]) ? args[0] : args; const o = a[0] && typeof a[0] === 'object' ? a[0] : { port: a[0], host: typeof a[1] === 'string' ? a[1] : 'localhost' }; if (o.path || !valid(o.host ?? 'localhost', o.port)) throw new Error('QA emulator CLI blocked outbound socket.'); return originalConnect.apply(this, args); };\ntls.connect = () => { throw new Error('QA emulator CLI blocked TLS.'); };\nconst originalHttp2 = http2.connect; http2.connect = function (authority, ...args) { const u = new URL(authority); if (u.protocol !== 'http:' || !valid(u.hostname, u.port)) throw new Error('QA emulator CLI blocked HTTP2.'); return originalHttp2.call(this, authority, ...args); };\nconst originalFetch = globalThis.fetch; globalThis.fetch = async function (input, init = {}) { const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url); if (u.protocol !== 'http:' || !valid(u.hostname, u.port) || u.username || u.password) throw new Error('QA emulator CLI blocked fetch.'); return originalFetch(input, { ...init, redirect: 'error' }); };\nconst originalLookup = dns.lookup; dns.lookup = function (host, ...args) { if (!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('QA emulator CLI blocked DNS.'); return originalLookup.call(this, host, ...args); };\nfor (const object of [dns, dns.promises]) for (const name of Object.keys(object).filter(n => /^(resolve|reverse)/.test(n))) if (typeof object[name] === 'function') object[name] = () => { throw new Error('QA emulator CLI blocked DNS.'); };\nconst originalPromiseLookup = dns.promises.lookup; dns.promises.lookup = async function (host, ...args) { if (!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('QA emulator CLI blocked DNS.'); return originalPromiseLookup.call(this, host, ...args); };\ndgram.Socket.prototype.send = () => { throw new Error('QA emulator CLI blocked UDP.'); };\n`;
}

export async function assertPortsUnused(ports, createServer = () => net.createServer()) {
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid owned emulator port.');
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', () => reject(new Error(`Connected QA port ${port} already belongs to another listener.`)));
      server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
    });
  }
}

function prepareFiles() {
  assertInside(path.join(repositoryRoot, 'out'), emulatorRoot);
  const env = createEmulatorEnvironment();
  for (const name of ['user-home', 'tmp', 'config/configstore', 'data', 'public-cache']) fs.mkdirSync(path.join(emulatorRoot, name), { recursive: true });
  fs.writeFileSync(path.join(env.XDG_CONFIG_HOME, 'configstore/firebase-tools.json'), '{"usage":false}\n');
  const publicJar = path.join(repositoryRoot, 'out/tools/firebase-emulators', firestoreJarName);
  if (createHash('sha256').update(fs.readFileSync(publicJar)).digest('hex') !== firestoreJarDigest) throw new Error('Public Firestore emulator binary digest mismatch.');
  fs.copyFileSync(publicJar, path.join(env.FIREBASE_EMULATORS_PATH, firestoreJarName));
  for (const name of ['firestore.rules', 'firestore.indexes.json']) fs.copyFileSync(path.join(repositoryRoot, 'player-app', name), path.join(emulatorRoot, name));
  fs.writeFileSync(path.join(emulatorRoot, 'firebase.json'), JSON.stringify(connectedEmulatorConfiguration(), null, 2));
  fs.writeFileSync(path.join(emulatorRoot, 'networkGuard.cjs'), emulatorNetworkGuardSource());
  return env;
}

async function waitReady(child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Connected emulators exited (${child.exitCode}).`);
    const results = await Promise.allSettled([fixedConnectedTarget.firestore.port, fixedConnectedTarget.auth.port].map(port => fetch(`http://127.0.0.1:${port}/`, { redirect: 'error', signal: AbortSignal.timeout(1000) })));
    if (results.every(result => result.status === 'fulfilled')) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Connected emulators did not become ready within 60 seconds.');
}

export async function startConnectedEmulators() {
  const ports = [fixedConnectedTarget.firestore.port, fixedConnectedTarget.auth.port, fixedConnectedTarget.api.port, ...Object.values(emulatorControlPorts)];
  await assertPortsUnused(ports);
  const environment = prepareFiles();
  const log = fs.createWriteStream(path.join(emulatorRoot, 'emulators.log'), { flags: 'a' });
  log.write(`\n--- emulator attempt ${new Date().toISOString()} ---\n`);
  const child = spawn(process.execPath, ['--require', path.join(emulatorRoot, 'networkGuard.cjs'), path.join(repositoryRoot, 'node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:start', '--project', fixedConnectedTarget.projectId, '--only', 'auth,firestore', '--config', path.join(emulatorRoot, 'firebase.json')], { cwd: emulatorRoot, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const output of [child.stdout, child.stderr]) output.on('data', chunk => log.write(chunk));
  const runtime = { child, log, environment, root: emulatorRoot };
  fs.writeFileSync(path.join(emulatorRoot, 'owned-runtime.json'), JSON.stringify({ wrapperPid: process.pid, cliPid: child.pid, projectId: fixedConnectedTarget.projectId, startedAt: new Date().toISOString() }));
  try { await waitReady(child); return runtime; } catch (error) { await stopConnectedEmulators(runtime); throw error; }
}

export async function stopConnectedEmulators(runtime) {
  if (runtime.child.exitCode === null && runtime.child.pid) {
    if (process.platform === 'win32') {
      // Only the process tree spawned by this runtime; never search or kill other Java/ADB processes.
      const child = spawn('C:/Windows/System32/taskkill.exe', ['/PID', String(runtime.child.pid), '/T', '/F'], { env: runtime.environment, windowsHide: true, stdio: 'ignore' });
      await new Promise(resolve => { child.on('error', resolve); child.on('close', resolve); });
    } else runtime.child.kill('SIGTERM');
  }
  runtime.log.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--run')) console.log('Connected emulator preparation only. Use --run for the fixed local demo project.');
  else startConnectedEmulators().then(runtime => {
    console.log(JSON.stringify({ ready: true, projectId: fixedConnectedTarget.projectId, firestorePort: fixedConnectedTarget.firestore.port, authPort: fixedConnectedTarget.auth.port }));
    const stop = async () => { await stopConnectedEmulators(runtime); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    process.on('message', message => { if (message?.type === 'stop') void stop(); });
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
