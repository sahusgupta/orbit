import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workspaceRoot = process.cwd();
const unpackedDirectory = path.join(workspaceRoot, 'release', 'win-unpacked');
const executablePath = path.join(unpackedDirectory, 'Orbit.exe');
const userDataDirectory = await mkdtemp(path.join(tmpdir(), 'orbit-packaged-smoke-'));
const mainProcessOutput = [];
const isolatedEnvironment = { ...process.env };
delete isolatedEnvironment.ELECTRON_RUN_AS_NODE;
let signalReady;
const ready = new Promise((resolve) => { signalReady = resolve; });

const server = createServer((request, response) => {
  if (request.url === '/ready') {
    response.writeHead(204).end();
    signalReady();
    return;
  }
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html><head><title>Orbit packaged smoke</title></head><body><script>fetch("/ready").finally(() => setTimeout(() => window.close(), 50));</script></body></html>');
});

await access(executablePath);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(5173, '127.0.0.1', resolve);
});

let applicationProcess;
let applicationExit;
try {
  applicationProcess = spawn(executablePath, ['--enable-logging=stderr'], {
    cwd: unpackedDirectory,
    env: {
      ...isolatedEnvironment,
      ELECTRON_DEV: 'true',
      ORBIT_API_URL: 'http://127.0.0.1:9',
      ORBIT_CLIENT_API_KEY: '',
      ORBIT_ENABLE_EMBEDDED_BACKEND: 'false',
      TABLEMANAGER_USER_DATA_DIR: userDataDirectory
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  applicationProcess.stdout.on('data', (chunk) => mainProcessOutput.push(chunk.toString()));
  applicationProcess.stderr.on('data', (chunk) => mainProcessOutput.push(chunk.toString()));
  applicationExit = new Promise((resolve) => {
    applicationProcess.once('error', (error) => resolve({ error }));
    applicationProcess.once('exit', (code, signal) => resolve({ code, signal }));
  });
  let startupTimeout;
  const timeout = new Promise((resolve) => {
    startupTimeout = setTimeout(() => resolve({ type: 'timeout' }), 30_000);
  });
  const outcome = await Promise.race([
    ready.then(() => ({ type: 'ready' })),
    applicationExit.then((result) => ({ type: 'exit', result })),
    timeout
  ]);
  clearTimeout(startupTimeout);

  if (outcome.type === 'timeout') {
    throw new Error(`Packaged Electron did not reach its isolated renderer.\n${mainProcessOutput.join('')}`);
  }
  if (outcome.type === 'exit') {
    throw outcome.result.error || new Error(`Packaged Electron exited before startup with code ${outcome.result.code} and signal ${outcome.result.signal}.\n${mainProcessOutput.join('')}`);
  }

  const gracefulExit = await Promise.race([
    applicationExit,
    new Promise((resolve) => setTimeout(() => resolve(null), 5_000))
  ]);
  if (!gracefulExit) {
    applicationProcess.kill();
    await applicationExit;
  }
  const fatalOutput = mainProcessOutput.join('');
  if (/Cannot find module|Uncaught Exception|JavaScript error occurred/i.test(fatalOutput)) {
    throw new Error(`Packaged Electron reported a fatal startup error:\n${fatalOutput}`);
  }
  console.log('Packaged Electron startup passed with an isolated renderer and disabled external services.');
} finally {
  if (applicationProcess?.exitCode === null && !applicationProcess.killed) {
    applicationProcess.kill();
    await applicationExit;
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(userDataDirectory, { recursive: true, force: true });
}
