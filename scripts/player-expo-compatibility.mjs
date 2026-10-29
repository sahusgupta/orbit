import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';

export const expoVersionsUrl = 'https://api.expo.dev/v2/versions/latest';
export const expoNativeModulesUrl = 'https://api.expo.dev/v2/sdks/58.0.0/native-modules';
const upToDate = 'Dependencies are up to date';
const offlineUpToDate = `${upToDate}\nDependency validation is unreliable in offline-mode`;
const reviewedMismatch = [
  'The following packages should be updated for best compatibility with the installed expo version:',
  'react-native@0.88.1 - expected version: 0.88.0',
  'Your project may not work correctly until you install the expected versions of the packages.',
  'Found outdated dependencies'
].join('\n');
const reviewedDoctorMismatch = [
  'Running 20 checks on your project...',
  '19/20 checks passed. 1 checks failed. Possible issues detected:',
  'Use the --verbose flag to see more details about passed checks.',
  '✖ Check that packages match versions required by installed Expo SDK',
  '🔧 Patch version mismatches',
  'package       expected  found',
  'react-native  0.88.0    0.88.1',
  '1 package out of date.',
  'Advice:',
  "Use 'npx expo install --check' to review and upgrade your dependencies.",
  'To ignore specific packages, add them to "expo.install.exclude" in package.json. Learn more: https://expo.fyi/dependency-validation',
  '1 check failed, indicating possible issues with the project.'
].join('\n');

export function expoCompatibilityEnvironment(parentEnvironment, offline = false) {
  const environment = { ...parentEnvironment, EXPO_NO_CACHE: '1', EXPO_NO_TELEMETRY: '1', NO_COLOR: '1' };
  for (const key of [
    'FORCE_COLOR', 'EXPO_OFFLINE', 'EXPO_API_HOST', 'EXPO_STAGING', 'EXPO_LOCAL', 'EAS_BUILD_PLATFORM',
    'EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK', 'EXPO_DOCTOR_ENABLE_DIRECTORY_CHECK', 'EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS'
  ]) delete environment[key];
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
  if (!result || !Number.isInteger(result.status) || result.status < 0
    || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || result.signal !== null) {
    fail(`Expo ${label} compatibility check did not complete normally.`);
  }
}

function assertRecord(value, label) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
}

function assertReviewedInstall(installed) {
  assertRecord(installed, 'Installed Expo compatibility evidence');
  assert.equal(installed.expoVersion, '58.0.21', 'Compatibility metadata resolution requires the reviewed Expo 58.0.21.');
  assert.equal(installed.reactNativeVersion, '0.88.1', 'Installed React Native must remain the reviewed 0.88.1.');
  assertRecord(installed.bundledNativeModules, 'Bundled Expo SDK module matrix');
  assert.equal(installed.bundledNativeModules['react-native'], '0.88.1', 'Bundled SDK must require React Native 0.88.1.');
  for (const [name, range] of Object.entries(installed.bundledNativeModules)) {
    assert.ok(name.length > 0 && typeof range === 'string' && range.length > 0, 'Bundled SDK module entries must be version strings.');
  }
}

function assertReviewedMetadata(installed, versions, nativeModules) {
  assertRecord(versions?.data?.sdkVersions, 'Fresh Expo SDK versions');
  const sdk = versions.data.sdkVersions['58.0.0'];
  assertRecord(sdk, 'Fresh SDK 58 version metadata');
  assert.equal(sdk.expoVersion, '~58.0.21', 'Fresh Expo release metadata no longer matches the reviewed conflict.');
  assert.equal(sdk.facebookReactNativeVersion, '0.88.0', 'Fresh React Native metadata no longer matches the CLI conflict.');

  assert.ok(Array.isArray(nativeModules?.data) && nativeModules.data.length > 0, 'Fresh native-module metadata must be a nonempty array.');
  const remote = new Map();
  for (const entry of nativeModules.data) {
    assertRecord(entry, 'Fresh native-module entry');
    assert.equal(entry.sdkVersion, '58.0.0', 'Fresh native-module entry must belong to SDK 58.0.0.');
    assert.ok(typeof entry.npmPackage === 'string' && entry.npmPackage.length > 0
      && typeof entry.versionRange === 'string' && entry.versionRange.length > 0, 'Fresh native-module entry has invalid shape.');
    assert.ok(!remote.has(entry.npmPackage), 'Fresh native-module metadata contains a duplicate package.');
    remote.set(entry.npmPackage, entry.versionRange);
  }
  assert.equal(remote.get('react-native'), '0.88.1', 'Fresh native-module matrix must require React Native 0.88.1.');
  assert.deepEqual([...remote.keys()].sort(), Object.keys(installed.bundledNativeModules).sort(), 'Fresh and bundled native-module package sets must agree.');
  for (const [name, range] of remote) {
    assert.equal(range, installed.bundledNativeModules[name], `Fresh and bundled native-module versions disagree for ${name}.`);
  }
}

export async function fetchExpoPublicMetadata(url, fetchImplementation = fetch) {
  assert.ok(url === expoVersionsUrl || url === expoNativeModulesUrl, 'Only the two reviewed public Expo metadata endpoints may be fetched.');
  const response = await fetchImplementation(url, {
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(15_000)
  });
  assert.ok(response.ok && response.status === 200 && response.url === url && response.redirected === false,
    'Public Expo metadata request failed or changed endpoint.');
  assert.ok(response.headers.get('content-type')?.startsWith('application/json'), 'Public Expo metadata must be JSON.');
  const body = await response.text();
  assert.ok(Buffer.byteLength(body, 'utf8') <= 2 * 1024 * 1024, 'Public Expo metadata response is unexpectedly large.');
  return JSON.parse(body);
}

export async function verifyPlayerExpoCompatibility({ installed, runCheck, fetchJson = fetchExpoPublicMetadata }) {
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
  if (live.status === 0) {
    if (output(live) !== upToDate) fail('The live Expo compatibility check returned unexpected output.');
    return { metadataConflict: false };
  }
  if (live.status !== 1 || output(live) !== reviewedMismatch) {
    fail('The live Expo compatibility check has an unreviewed failure.', live.status || 1);
  }
  const [versions, nativeModules] = await Promise.all([
    fetchJson(expoVersionsUrl), fetchJson(expoNativeModulesUrl)
  ]);
  assertReviewedMetadata(installed, versions, nativeModules);
  return { metadataConflict: true };
}

export async function verifyPlayerExpoDoctor({ doctorVersion, doctorResult, runCompatibilityCheck }) {
  assertCommandResult(doctorResult, 'Doctor');
  assert.equal(doctorVersion, '1.20.4', 'Doctor metadata resolution requires the reviewed Expo Doctor 1.20.4.');
  if (doctorResult.status === 0) {
    assert.equal(output(doctorResult), 'Running 20 checks on your project...\n20/20 checks passed. No issues detected!',
      'Successful Doctor output must show all 20 original checks passed without other warnings.');
    return { rawPassed: true, metadataConflict: false };
  }
  if (doctorResult.status !== 1 || output(doctorResult) !== reviewedDoctorMismatch) {
    fail('Expo Doctor has an unreviewed failure; its result cannot be resolved by the metadata check.', doctorResult.status || 1);
  }
  const resolution = await runCompatibilityCheck();
  assert.equal(resolution?.metadataConflict, true, 'Doctor failure must match the independently reproduced fresh metadata conflict.');
  return { rawPassed: false, metadataConflict: true };
}
