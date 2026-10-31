import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';

const upToDate = 'Dependencies are up to date';
const offlineUpToDate = `${upToDate}\nDependency validation is unreliable in offline-mode`;

export function expoCompatibilityEnvironment(parentEnvironment, offline = false) {
  const controlled = { EXPO_NO_CACHE: '1', EXPO_NO_TELEMETRY: '1', NO_COLOR: '1' };
  const excludedKeys = new Set([
    'FORCE_COLOR', 'EXPO_OFFLINE', 'EXPO_API_HOST', 'EXPO_STAGING', 'EXPO_LOCAL', 'EAS_BUILD_PLATFORM',
    'EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK', 'EXPO_DOCTOR_ENABLE_DIRECTORY_CHECK', 'EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS',
    ...Object.keys(controlled)
  ]);
  const environment = Object.fromEntries(Object.entries(parentEnvironment ?? {})
    .filter(([key]) => !excludedKeys.has(key.toUpperCase())));
  Object.assign(environment, controlled);
  if (offline) environment.EXPO_OFFLINE = '1';
  return environment;
}

function fail(message, exitCode = 1) {
  throw Object.assign(new Error(message), { exitCode });
}

function output(result) {
  return stripVTControlCharacters([result.stdout, result.stderr].filter(Boolean).join('\n'))
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n');
}

function assertCommandResult(result, label) {
  if (result?.error) throw result.error;
  if (!result || !Number.isInteger(result.status) || result.status < 0 || result.status > 255
    || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || result.signal !== null) {
    fail(`Expo ${label} compatibility check did not complete normally.`);
  }
}

function assertRecord(value, label) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
}

function assertReviewedInstall(installed) {
  assertRecord(installed, 'Installed Expo compatibility evidence');
  assert.equal(installed.expoVersion, '58.0.22', 'Validation requires the reviewed Expo 58.0.22.');
  assert.equal(installed.reactNativeVersion, '0.88.1', 'Installed React Native must remain the reviewed 0.88.1.');
  assertRecord(installed.bundledNativeModules, 'Bundled Expo SDK module matrix');
  assert.equal(installed.bundledNativeModules['react-native'], '0.88.1', 'Bundled SDK must require React Native 0.88.1.');
  for (const [name, range] of Object.entries(installed.bundledNativeModules)) {
    assert.ok(name.length > 0 && typeof range === 'string' && range.length > 0, 'Bundled SDK module entries must be version strings.');
  }
}

export async function verifyPlayerExpoCompatibility({ installed, runCheck }) {
  // Both commands run even if the first command throws or exits nonzero.
  const capture = async (offline) => {
    try { return await runCheck({ offline }); }
    catch (error) { return { error }; }
  };
  const live = await capture(false);
  const offline = await capture(true);
  assertCommandResult(live, 'live');
  assertCommandResult(offline, 'bundled SDK');
  if (offline.status !== 0 || output(offline) !== offlineUpToDate) {
    fail('The independent bundled SDK compatibility check failed.', offline.status || 1);
  }
  assertReviewedInstall(installed);
  if (live.status !== 0) fail('The live Expo compatibility check failed.', live.status || 1);
  if (output(live) !== upToDate) fail('The live Expo compatibility check returned unexpected output.');
  return { metadataConflict: false };
}

export async function verifyPlayerExpoDoctor({ installed, doctorVersion, doctorResult }) {
  assertCommandResult(doctorResult, 'Doctor');
  assert.equal(doctorVersion, '1.20.4', 'Validation requires the reviewed Expo Doctor 1.20.4.');
  assertReviewedInstall(installed);
  if (doctorResult.status !== 0) {
    fail('Expo Doctor failed; all 20 original checks must pass.', doctorResult.status || 1);
  }
  assert.equal(output(doctorResult), 'Running 20 checks on your project...\n20/20 checks passed. No issues detected!',
    'Successful Doctor output must show all 20 original checks passed without other warnings.');
  return { rawPassed: true, metadataConflict: false };
}
