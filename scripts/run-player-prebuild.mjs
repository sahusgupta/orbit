import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localPlayerBinary, playerRoot, productionPlayerEnvironment } from './player-release-environment.mjs';
import { verifyPlayerNative } from './verify-player-native.mjs';

if (!['darwin', 'linux'].includes(process.platform)) {
  throw new Error('Managed iOS prebuild verification requires Linux or macOS; CI runs this gate on Ubuntu.');
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-player-prebuild-'));
const temporaryPlayer = path.join(temporaryRoot, 'player-app');
const expoCli = localPlayerBinary('expo', path.join('bin', 'cli'));

try {
  fs.cpSync(playerRoot, temporaryPlayer, {
    recursive: true,
    filter(source) {
      const relative = path.relative(playerRoot, source);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return !['.env', '.expo', 'android', 'ios', 'node_modules'].includes(first)
        && !first.startsWith('dist-');
    }
  });
  fs.symlinkSync(path.join(playerRoot, 'node_modules'), path.join(temporaryPlayer, 'node_modules'), 'dir');
  const result = spawnSync(process.execPath, [expoCli, 'prebuild', '--platform', 'ios', '--no-install'], {
    cwd: temporaryPlayer,
    env: productionPlayerEnvironment(),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  verifyPlayerNative(path.join(temporaryPlayer, 'ios'));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
