import { spawn } from 'node:child_process';

const workspaceRoot = process.cwd();
const port = 4174;
const target = `http://127.0.0.1:${port}`;
const nodeExecutable = process.execPath;

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: workspaceRoot, stdio: 'inherit', ...options });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}.`)));
});

const vite = spawn(nodeExecutable, [
  'node_modules/vite/bin/vite.js',
  '--config', 'download-site/vite.config.mjs',
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort'
], {
  cwd: workspaceRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ORBIT_PUBLIC_LOCAL_ORIGIN: target }
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
  if (!ready) throw new Error('Isolated public-site smoke server did not become ready.');
  await run(nodeExecutable, ['tests/e2e/public-site-smoke.mjs'], {
    env: { ...process.env, ORBIT_PUBLIC_URL: target }
  });
} finally {
  vite.kill('SIGTERM');
}
