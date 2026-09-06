import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localPlayerBinary, playerRoot, productionPlayerEnvironment, repositoryRoot } from './player-release-environment.mjs';
import { verifyPlayerNative } from './verify-player-native.mjs';

assert.equal(process.platform, 'darwin', 'Native simulator QA requires macOS.');
const environment = productionPlayerEnvironment();
const evidenceRoot = path.join(repositoryRoot, 'out', 'player-simulator-qa');
const iosRoot = path.join(playerRoot, 'ios');
assert.ok(!fs.existsSync(iosRoot), 'Use a clean checkout; existing native work must not be overwritten.');
fs.mkdirSync(evidenceRoot, { recursive: true });

function run(command, arguments_, options = {}) {
  const startedAt = Date.now();
  const label = options.log || [path.basename(command), ...arguments_.slice(0, 3)].join(' ');
  console.log(`Starting ${label}.`);
  const logPath = options.log ? path.join(evidenceRoot, options.log) : null;
  // Persist compiler output as it arrives, including when CI cancels the job.
  const logFile = logPath ? fs.openSync(logPath, 'w') : null;
  let result;
  try {
    result = spawnSync(command, arguments_, {
      cwd: options.cwd || playerRoot,
      env: environment,
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
      timeout: 2 * 60 * 1000,
      killSignal: 'SIGKILL',
      ...options,
      ...(logFile !== null ? { stdio: ['ignore', logFile, logFile] } : {})
    });
  } finally {
    if (logFile !== null) fs.closeSync(logFile);
  }
  if (result.error) throw new Error(`${label}: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) {
    process.stderr.write(logPath
      ? fs.readFileSync(logPath, 'utf8').split('\n').slice(-100).join('\n')
      : `${result.stdout || ''}\n${result.stderr || ''}`);
    throw new Error(`${command} failed with exit ${result.status}.`);
  }
  console.log(`Finished ${label} in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
  return result.stdout || '';
}

const sourceSha = run('git', ['rev-parse', 'HEAD']).trim();
const xcodeVersion = run('xcodebuild', ['-version']).trim();
fs.writeFileSync(path.join(evidenceRoot, 'source.json'), JSON.stringify({
  sourceSha, xcodeVersion, bundleIdentifier: 'com.orbit.player',
  configuration: 'Release', signing: 'ad-hoc simulator; no Apple certificate', startedAt: new Date().toISOString()
}, null, 2));
// Detect an unavailable CoreSimulator service before spending time compiling.
const runtimeInventory = run('xcrun', ['simctl', 'list', 'runtimes', '--json']);
fs.writeFileSync(path.join(evidenceRoot, 'simulator-runtimes.json'), runtimeInventory);
const runtimes = JSON.parse(runtimeInventory).runtimes;
const runtime = runtimes.find((entry) => entry.isAvailable && entry.identifier.includes('iOS-26'))
  || runtimes.find((entry) => entry.isAvailable && entry.identifier.includes('iOS-18'));
assert.ok(runtime, 'An available supported iOS simulator runtime is required.');
run(process.execPath, [localPlayerBinary('expo', 'bin/cli'), 'prebuild', '--platform', 'ios', '--no-install'], { log: 'prebuild.log' });
verifyPlayerNative(iosRoot);
run('pod', ['install'], { cwd: iosRoot, log: 'pods.log', timeout: 15 * 60 * 1000 });
const derivedData = path.join(evidenceRoot, 'derived');
const simulatorArchitecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
run('xcodebuild', [
  '-workspace', 'OrbitPlayer.xcworkspace', '-scheme', 'OrbitPlayer',
  '-configuration', 'Release', '-sdk', 'iphonesimulator',
  '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derivedData,
  `ARCHS=${simulatorArchitecture}`, 'ONLY_ACTIVE_ARCH=YES',
  // Xcode must embed simulator application/keychain entitlements. Disabling
  // signing makes SecureStore fail with errSecMissingEntitlement (-34018).
  // The ad-hoc identity needs no Apple certificate, team, or provisioning access.
  'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'build'
], { cwd: iosRoot, log: 'xcodebuild.log', timeout: 40 * 60 * 1000 });
const application = path.join(derivedData, 'Build', 'Products', 'Release-iphonesimulator', 'OrbitPlayer.app');
assert.ok(fs.existsSync(application), 'Xcode must produce the simulator application.');
run('codesign', ['--verify', '--deep', '--strict', application]);
run('codesign', ['--display', '--verbose=2', application], { log: 'simulator-signature.log' });
const signingEntitlements = fs.readdirSync(derivedData, { recursive: true })
  .filter((name) => name.endsWith('.xcent') && name.includes('OrbitPlayer.build'))
  .map((name) => ({
    path: name,
    entitlements: JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path.join(derivedData, name)]))
  }));
fs.writeFileSync(path.join(evidenceRoot, 'simulator-entitlements.json'), JSON.stringify(signingEntitlements, null, 2));
assert.ok(signingEntitlements.some(({ entitlements }) =>
  String(entitlements['application-identifier'] || '').endsWith('com.orbit.player')
), 'The simulator build must include its Keychain application identity.');
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', application, path.join(evidenceRoot, 'OrbitPlayer-simulator.zip')]);
const manifestPaths = fs.readdirSync(application, { recursive: true }).filter((name) => name.endsWith('.xcprivacy'));
fs.writeFileSync(path.join(evidenceRoot, 'privacy-manifests.json'), JSON.stringify(manifestPaths.map((name) => ({
  path: name,
  manifest: JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path.join(application, name)]))
})), null, 2));
fs.writeFileSync(path.join(evidenceRoot, 'app-info.json'), run('plutil', ['-convert', 'json', '-o', '-', path.join(application, 'Info.plist')]));
let failed = false;
for (const device of ['iPhone-16', 'iPhone-16-Pro-Max']) {
  const output = path.join(evidenceRoot, device);
  fs.mkdirSync(output, { recursive: true });
  const udid = run('xcrun', ['simctl', 'create', `Orbit QA ${device}`, `com.apple.CoreSimulator.SimDeviceType.${device}`, runtime.identifier]).trim();
  try {
    run('xcrun', ['simctl', 'boot', udid]);
    try {
      run('xcrun', ['simctl', 'bootstatus', udid, '-b'], { log: `${device}-boot.log`, timeout: 5 * 60 * 1000 });
    } catch (error) {
      if (error.cause?.code !== 'ETIMEDOUT') throw error;
      // A fresh hosted runtime can stall during its first boot. Restart only
      // this disposable device, before installing the app, and retain both logs.
      console.warn(`${device}: initial boot timed out; retrying this device once.`);
      run('xcrun', ['simctl', 'shutdown', udid]);
      run('xcrun', ['simctl', 'boot', udid]);
      run('xcrun', ['simctl', 'bootstatus', udid, '-b'], { log: `${device}-boot-retry.log`, timeout: 5 * 60 * 1000 });
    }
    run('xcrun', ['simctl', 'install', udid, application]);
    run('maestro', ['--device', udid, 'test', '--format', 'junit', '--output', path.join(output, 'results.xml'),
      '--test-output-dir', output, path.join(playerRoot, '.maestro', 'local-profile.yaml')], { cwd: output, log: `${device}.log`, timeout: 10 * 60 * 1000 });
  } catch (error) {
    failed = true;
    console.error(`${device}: ${error.message}`);
  } finally {
    run('xcrun', ['simctl', 'shutdown', udid]);
    run('xcrun', ['simctl', 'delete', udid]);
  }
}
// Upload the app and review evidence, not the large intermediate compiler cache.
assert.equal(path.dirname(derivedData), evidenceRoot);
fs.rmSync(derivedData, { recursive: true, force: true });
assert.equal(failed, false, 'One or more native simulator flows failed; inspect the preserved evidence.');
console.log('Both iPhone simulator flows passed. App/signing and App Attest hardware gates remain separate.');
