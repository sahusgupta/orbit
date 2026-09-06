import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localPlayerBinary, playerRoot, productionPlayerEnvironment } from './player-release-environment.mjs';

// Run the same native schema generator CocoaPods invokes, without Xcode or pods.
// This catches dependency API incompatibilities that JS export/prebuild miss.
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-player-codegen-'));
try {
  const generator = localPlayerBinary('react-native', 'scripts/generate-codegen-artifacts.js');
  const result = spawnSync(process.execPath, [generator, '-p', playerRoot, '-o', temporaryRoot, '-t', 'ios'], {
    cwd: playerRoot,
    env: productionPlayerEnvironment(),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'React Native iOS schema/code generation failed.');
  const generatedRoot = path.join(temporaryRoot, 'build', 'generated', 'ios');
  for (const file of ['ReactCodegen.podspec', 'RCTAppDependencyProvider.mm', 'RCTModuleProviders.mm']) {
    assert.ok(fs.statSync(path.join(generatedRoot, file)).size > 0, `Missing generated native artifact: ${file}`);
  }
  console.log('Player native code generation and required provider artifacts passed.');
} finally {
  // Only remove the exact newly-created temporary directory after containment checks.
  assert.equal(path.dirname(path.resolve(temporaryRoot)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporaryRoot).startsWith('orbit-player-codegen-'));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
