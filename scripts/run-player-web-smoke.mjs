import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

const workspaceRoot = process.cwd();
const webRoot = path.join(workspaceRoot, 'player-web');
const webPort = 4175;
const apiPort = 4629;
const webTarget = `http://127.0.0.1:${webPort}`;
const apiTarget = `http://127.0.0.1:${apiPort}`;
const nodeExecutable = process.execPath;
const nextCli = path.join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const fixtureApi = path.join(webRoot, 'tests', 'browser', 'fixture-api.mjs');

const isolatedEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(?:ORBIT_|NEXT_PUBLIC_|FIREBASE_|GOOGLE_|STRIPE_|REVENUECAT_|TWILIO_|SMTP_)/.test(name)
));
Object.assign(isolatedEnvironment, {
  CI: process.env.CI || '1',
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_ENABLE_FIREBASE_SYNC: 'false',
  NEXT_PUBLIC_ORBIT_API_URL: apiTarget,
  NEXT_PUBLIC_PLAYER_WEB_URL: webTarget,
  NODE_ENV: 'production',
  ORBIT_API_URL: apiTarget,
  ORBIT_QA_API_PORT: String(apiPort)
});

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspaceRoot, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(command)} ${args.join(' ')} exited with ${code}.`)));
  });
}

async function waitFor(target, label, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`${label} exited with ${child.exitCode} before becoming ready.`);
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // A refused loopback request is expected while the isolated process starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} did not become ready at ${target}.`);
}

async function stop(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 3_000))
  ]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

await run(nodeExecutable, [nextCli, 'build'], { cwd: webRoot, env: isolatedEnvironment });

const api = spawn(nodeExecutable, ['--experimental-strip-types', fixtureApi], {
  cwd: workspaceRoot,
  env: isolatedEnvironment,
  stdio: 'inherit'
});
let web;

try {
  await waitFor(`${apiTarget}/health`, 'Player Web fixture API', api);
  web = spawn(nodeExecutable, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(webPort)], {
    cwd: webRoot,
    env: isolatedEnvironment,
    stdio: 'inherit'
  });
  await waitFor(webTarget, 'Player Web production server', web);
  await run(nodeExecutable, [path.join(workspaceRoot, 'tests', 'e2e', 'player-web-smoke.mjs')], {
    env: {
      ...isolatedEnvironment,
      ORBIT_PLAYER_WEB_URL: webTarget,
      ORBIT_PLAYER_WEB_SCREENSHOTS: path.join(workspaceRoot, 'test-results', 'player-web', 'screenshots')
    }
  });
} finally {
  await stop(web);
  await stop(api);
}
