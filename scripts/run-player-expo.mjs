import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localPlayerBinary, playerRoot, productionPlayerEnvironment } from './player-release-environment.mjs';
import { reviewedPlayerCollectedDataTypes } from './player-privacy-manifest.mjs';
import { verifyPlayerBundle } from './verify-player-bundle.mjs';
import { expoCompatibilityEnvironment, verifyPlayerExpoCompatibility, verifyPlayerExpoDoctor } from './player-expo-compatibility.mjs';

const action = process.argv[2];
const expoCli = localPlayerBinary('expo', path.join('bin', 'cli'));
const expoDoctorCli = localPlayerBinary('expo-doctor', path.join('bin', 'expo-doctor.js'));
const environment = productionPlayerEnvironment();

function runPlayerTool(binary, arguments_, options = {}) {
  const result = spawnSync(process.execPath, [binary, ...arguments_], {
    cwd: options.cwd || playerRoot,
    encoding: 'utf8',
    env: options.environment || environment,
    maxBuffer: 50 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    process.stderr.write(output || 'Expo command failed without output.\n');
    process.exit(result.status || 1);
  }
  return result.stdout;
}

function runExpo(arguments_, options = {}) {
  return runPlayerTool(expoCli, arguments_, options);
}

function inspectResolvedConfig() {
  const publicConfig = JSON.parse(runExpo(['config', '--type', 'public', '--json']));
  assert.equal(publicConfig.name, 'Orbit Player');
  assert.equal(publicConfig.version, '1.0.0');
  assert.equal(publicConfig.sdkVersion, '58.0.0', 'The reviewed SDK 58 runtime always uses the New Architecture');
  const reactNativePackage = JSON.parse(fs.readFileSync(path.join(playerRoot, 'node_modules', 'react-native', 'package.json'), 'utf8'));
  assert.equal(reactNativePackage.version, '0.88.1', 'Native App Check must use the reviewed New Architecture-only runtime');
  assert.equal(publicConfig.newArchEnabled, undefined, 'SDK 58 must not configure the removed architecture option');
  assert.equal(publicConfig.ios?.bundleIdentifier, 'com.caminuslabs.orbit');
  assert.equal(publicConfig.android?.package, 'com.orbit.player');
  assert.equal(publicConfig.ios?.infoPlist?.ITSAppUsesNonExemptEncryption, false);
  assert.equal(publicConfig.ios?.privacyManifests?.NSPrivacyTracking, false);
  assert.deepEqual(
    publicConfig.ios?.privacyManifests?.NSPrivacyCollectedDataTypes,
    reviewedPlayerCollectedDataTypes,
    'Production config must preserve the reviewed app-owned collected-data declaration'
  );
  assert.equal(publicConfig.scheme, undefined, 'Production config must not expose an unused URL scheme');
  assert.deepEqual(Object.keys(publicConfig.extra || {}), ['eas'], 'Only the public EAS project identifier may remain in Expo extra');

  const introspected = JSON.parse(runExpo(['config', '--type', 'introspect', '--json']));
  const infoPlist = introspected._internal?.modResults?.ios?.infoPlist || {};
  const entitlements = introspected._internal?.modResults?.ios?.entitlements || {};
  assert.deepEqual(entitlements, {
    'com.apple.developer.devicecheck.appattest-environment': 'production'
  }, 'Production config must declare only the required production App Attest entitlement');
  assert.equal(publicConfig.ios?.googleServicesFile, './GoogleService-Info.plist');
  assert.equal(
    infoPlist.NSCameraUsageDescription,
    'Allow Orbit Player to scan the PDF417 barcode on your government ID. Orbit does not save a photo.'
  );
  assert.equal(
    infoPlist.NSLocationWhenInUseUsageDescription,
    'Use your location once to find poker games within your selected distance. Orbit keeps this search point on your device.'
  );
  for (const key of [
    'NSMicrophoneUsageDescription',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSLocationAlwaysUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSUserTrackingUsageDescription',
    'NSContactsUsageDescription',
    'NSCalendarsUsageDescription',
    'NSCalendarsFullAccessUsageDescription',
    'NSCalendarsWriteOnlyAccessUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSFaceIDUsageDescription',
    'NSSpeechRecognitionUsageDescription',
    'NSMotionUsageDescription',
    'NSHealthShareUsageDescription',
    'NSHealthUpdateUsageDescription'
  ]) {
    assert.equal(infoPlist[key], undefined, `Production Info.plist must not contain ${key}`);
  }
  assert.ok(!infoPlist.CFBundleURLTypes?.length, 'Production Info.plist must not expose unused URL schemes');
  console.log('Orbit Player production Expo public config and introspected permissions passed.');
}

function exportIosBundle() {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-player-export-'));
  const bytecodeOutput = path.join(outputRoot, 'bytecode');
  const inspectableOutput = path.join(outputRoot, 'inspectable');
  const embeddedOutput = path.join(outputRoot, 'embedded');
  try {
    const bytecodeStdout = runExpo(['export', '--platform', 'ios', '--output-dir', bytecodeOutput, '--clear']);
    if (bytecodeStdout) process.stdout.write(bytecodeStdout);
    const bytecodeFiles = fs.readdirSync(bytecodeOutput, { recursive: true, withFileTypes: true });
    assert.ok(
      bytecodeFiles.some((entry) => entry.isFile() && entry.name.endsWith('.hbc')),
      'The production iOS export must contain a Hermes bytecode bundle.'
    );

    // Preserve the real Hermes export above, then export the same sanitized
    // production configuration as text so prohibited source cannot hide inside
    // a binary artifact that a string scanner silently skips.
    const inspectableStdout = runExpo([
      'export', '--platform', 'ios', '--output-dir', inspectableOutput, '--no-bytecode', '--source-maps', '--clear'
    ]);
    if (inspectableStdout) process.stdout.write(inspectableStdout);
    assert.ok(
      fs.readdirSync(inspectableOutput, { recursive: true }).some((file) => file.endsWith('.map')),
      'Inspectable production export must contain source maps for build-only dependency reachability checks.'
    );
    verifyPlayerBundle(inspectableOutput);
    fs.mkdirSync(embeddedOutput);
    // EAS/Xcode use export:embed, which reloads config after Metro adds its
    // project-root metadata. Exercise that distinct production build boundary.
    const embeddedBundle = path.join(embeddedOutput, 'main.js');
    const embeddedStdout = runExpo([
      'export:embed', '--platform', 'ios', '--dev', 'false',
      '--entry-file', 'node_modules/expo/AppEntry.js',
      '--bundle-output', embeddedBundle, '--sourcemap-output', path.join(embeddedOutput, 'main.js.map'),
      '--assets-dest', path.join(embeddedOutput, 'assets')
    ]);
    if (embeddedStdout) process.stdout.write(embeddedStdout);
    assert.ok(fs.statSync(embeddedBundle).size > 0, 'EAS embedded iOS bundle must exist.');
    assert.ok(fs.statSync(path.join(embeddedOutput, 'main.js.map')).size > 0, 'EAS embedded source map must exist.');
    verifyPlayerBundle(embeddedOutput);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}

function installedCompatibilityEvidence() {
  return {
    expoVersion: JSON.parse(fs.readFileSync(path.join(playerRoot, 'node_modules', 'expo', 'package.json'), 'utf8')).version,
    reactNativeVersion: JSON.parse(fs.readFileSync(path.join(playerRoot, 'node_modules', 'react-native', 'package.json'), 'utf8')).version,
    bundledNativeModules: JSON.parse(fs.readFileSync(path.join(playerRoot, 'node_modules', 'expo', 'bundledNativeModules.json'), 'utf8'))
  };
}

function captureCompatibilityTool(binary, arguments_, offline = false) {
  const result = spawnSync(process.execPath, [binary, ...arguments_], {
    cwd: playerRoot, encoding: 'utf8', env: expoCompatibilityEnvironment(environment, offline), maxBuffer: 50 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

async function checkExpoDependencies() {
  const result = await verifyPlayerExpoCompatibility({ installed: installedCompatibilityEvidence(),
    runCheck: ({ offline }) => captureCompatibilityTool(expoCli, ['install', '--check'], offline) });
  console.log(result.metadataConflict
    ? 'Verified the exact Expo 58.0.21 metadata conflict: fresh native-module and bundled SDK matrices agree; reviewed React Native 0.88.1 is retained.'
    : 'Live Expo and independent bundled SDK compatibility checks passed.');
  return result;
}

async function reportValidationFailure(action) {
  try { await action(); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode || 1;
  }
}

async function runExpoDoctor() {
  const doctorResult = captureCompatibilityTool(expoDoctorCli, []);
  const result = await verifyPlayerExpoDoctor({
    doctorVersion: JSON.parse(fs.readFileSync(path.join(playerRoot, 'node_modules', 'expo-doctor', 'package.json'), 'utf8')).version,
    doctorResult, runCompatibilityCheck: checkExpoDependencies
  });
  if (!result.rawPassed) console.log('Raw Expo Doctor exited 1 with 19/20 checks passed; the sole SDK-version metadata false positive was independently verified above.');
}

if (action === 'config') inspectResolvedConfig();
else if (action === 'check') await reportValidationFailure(checkExpoDependencies);
else if (action === 'doctor') await reportValidationFailure(runExpoDoctor);
else if (action === 'export') exportIosBundle();
else throw new Error('Usage: node scripts/run-player-expo.mjs <config|check|doctor|export>');
