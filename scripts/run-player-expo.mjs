import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localPlayerBinary, playerRoot, productionPlayerEnvironment } from './player-release-environment.mjs';
import { verifyPlayerBundle } from './verify-player-bundle.mjs';

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
  assert.equal(publicConfig.ios?.bundleIdentifier, 'com.orbit.player');
  assert.equal(publicConfig.ios?.infoPlist?.ITSAppUsesNonExemptEncryption, false);
  assert.equal(publicConfig.scheme, undefined, 'Production config must not expose an unused URL scheme');
  assert.deepEqual(Object.keys(publicConfig.extra || {}), ['eas'], 'Only the public EAS project identifier may remain in Expo extra');

  const introspected = JSON.parse(runExpo(['config', '--type', 'introspect', '--json']));
  const infoPlist = introspected._internal?.modResults?.ios?.infoPlist || {};
  const entitlements = introspected._internal?.modResults?.ios?.entitlements || {};
  assert.deepEqual(entitlements, {}, 'Production config must not declare app capabilities or entitlements');
  assert.equal(
    infoPlist.NSCameraUsageDescription,
    'Allow Orbit Player to scan the PDF417 barcode on your government ID. Orbit does not save a photo.'
  );
  for (const key of [
    'NSMicrophoneUsageDescription',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSLocationAlwaysUsageDescription',
    'NSLocationWhenInUseUsageDescription',
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
      'export', '--platform', 'ios', '--output-dir', inspectableOutput, '--no-bytecode', '--clear'
    ]);
    if (inspectableStdout) process.stdout.write(inspectableStdout);
    verifyPlayerBundle(inspectableOutput);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}

function checkExpoDependencies() {
  const stdout = runExpo(['install', '--check']);
  if (stdout) process.stdout.write(stdout);
}

function runExpoDoctor() {
  const stdout = runPlayerTool(expoDoctorCli, []);
  if (stdout) process.stdout.write(stdout);
}

if (action === 'config') inspectResolvedConfig();
else if (action === 'check') checkExpoDependencies();
else if (action === 'doctor') runExpoDoctor();
else if (action === 'export') exportIosBundle();
else throw new Error('Usage: node scripts/run-player-expo.mjs <config|check|doctor|export>');
