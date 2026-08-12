import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const workspaceRoot = process.cwd();
const port = 4175;
const apiPort = 4185;
const target = `http://127.0.0.1:${port}`;
const apiTarget = `http://127.0.0.1:${apiPort}`;
const nodeExecutable = process.execPath;
const isolatedEnvironment = {
  ...process.env,
  VITE_E2E_FIXTURE_MODE: 'true',
  VITE_ENABLE_FIREBASE_SYNC: 'false',
  VITE_ORBIT_LOCAL_API_URL: apiTarget
};

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: workspaceRoot, stdio: 'inherit', ...options });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}.`)));
});

await run(nodeExecutable, ['node_modules/vite/bin/vite.js', 'build'], { env: isolatedEnvironment });

let revision = 0;
const mockApi = createServer((request, response) => {
  response.setHeader('access-control-allow-origin', target);
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type, x-orbit-mutation-id');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method === 'GET' && request.url?.startsWith('/state/')) {
    response.writeHead(200).end(JSON.stringify({ accountKey: 'smoke-license', revision }));
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200).end(JSON.stringify({ ok: true, mode: 'isolated-smoke', publication: 'disabled' }));
    return;
  }
  if (request.method === 'POST' && request.url === '/state') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (!payload?.state || body.length > 2_000_000) throw new Error('Invalid isolated state payload.');
        revision += 1;
        response.writeHead(200).end(JSON.stringify({ ok: true, revision, publication: { status: 'disabled' } }));
      } catch {
        response.writeHead(400).end(JSON.stringify({ error: 'Invalid isolated request.' }));
      }
    });
    return;
  }
  response.writeHead(404).end(JSON.stringify({ error: 'Unknown isolated route.' }));
});

await new Promise((resolve, reject) => {
  const onError = (error) => reject(error);
  mockApi.once('error', onError);
  mockApi.listen(apiPort, '127.0.0.1', () => {
    mockApi.off('error', onError);
    resolve();
  });
});

const vite = spawn(nodeExecutable, [
  'node_modules/vite/bin/vite.js',
  'preview',
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort'
], {
  cwd: workspaceRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: isolatedEnvironment
});

try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(target);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!ready) throw new Error('Isolated management smoke server did not become ready.');
  await run(nodeExecutable, ['tests/e2e/management-core-smoke.mjs'], {
    env: { ...process.env, TABLE_MANAGER_URL: target }
  });
} finally {
  vite.kill('SIGTERM');
  await new Promise((resolve) => mockApi.close(resolve));
}
