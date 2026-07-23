const { spawn } = require('child_process');
const net = require('net');

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : 'npm';

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

async function findPlayerPort() {
  for (let port = 8081; port <= 8090; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error('No free Player app port was found between 8081 and 8090.');
}

async function main() {
  const playerPort = await findPlayerPort();
  const commands = [
    { label: 'Orbit local sync', args: ['run', 'api:dev'] },
    { label: 'Orbit Core', args: ['run', 'dev'] },
    { label: 'Orbit Player', args: ['--prefix', 'player-app', 'run', 'web', '--', '--port', String(playerPort)] }
  ];

  console.log('Starting linked Orbit development:');
  console.log('  Core:   http://127.0.0.1:5173');
  console.log(`  Player: http://127.0.0.1:${playerPort}`);
  console.log('  Sync:   http://127.0.0.1:4629');
  console.log('Press Ctrl+C once to stop all three.');

  const children = commands.map(({ label, args }) => {
    const spawnArgs = isWindows
      ? ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`]
      : args;
    const child = spawn(npmCommand, spawnArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      windowsHide: true
    });
    child.on('error', (error) => console.error(`${label} failed to start: ${error.message}`));
    return child;
  });

  let stopping = false;
  function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    children.forEach((child) => {
      if (!child.killed) child.kill('SIGTERM');
    });
    setTimeout(() => process.exit(exitCode), 250);
  }

  children.forEach((child, index) => {
    child.on('exit', (code) => {
      if (!stopping && code && code !== 0) {
        console.error(`${commands[index].label} stopped with exit code ${code}.`);
        stop(code);
      }
    });
  });

  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
