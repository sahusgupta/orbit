import { describe, expect, it, vi } from 'vitest';
import {
  expoCompatibilityEnvironment, expoNativeModulesUrl, expoVersionsUrl, fetchExpoPublicMetadata,
  verifyPlayerExpoCompatibility, verifyPlayerExpoDoctor
} from './player-expo-compatibility.mjs';

function fixture() {
  const live = { status: 1, signal: null, stdout: '', stderr: [
    'The following packages should be updated for best compatibility with the installed expo version:',
    '  react-native@0.88.1 - expected version: 0.88.0',
    'Your project may not work correctly until you install the expected versions of the packages.',
    'Found outdated dependencies\n'
  ].join('\n') };
  const offline = { status: 0, signal: null, stdout: 'Dependencies are up to date\n', stderr: 'Dependency validation is unreliable in offline-mode\n' };
  const installed = { expoVersion: '58.0.21', reactNativeVersion: '0.88.1', bundledNativeModules: { 'react-native': '0.88.1', 'expo-camera': '~58.0.14' } };
  const versions = { data: { sdkVersions: { '58.0.0': { expoVersion: '~58.0.21', facebookReactNativeVersion: '0.88.0' } } } };
  const nativeModules = { data: [
    { sdkVersion: '58.0.0', npmPackage: 'react-native', versionRange: '0.88.1' },
    { sdkVersion: '58.0.0', npmPackage: 'expo-camera', versionRange: '~58.0.14' }
  ] };
  const runCheck = vi.fn(({ offline: useBundle }) => useBundle ? offline : live);
  const fetchJson = vi.fn(async (url) => {
    if (url === expoVersionsUrl) return versions;
    if (url === expoNativeModulesUrl) return nativeModules;
    throw new Error('Unreviewed metadata endpoint');
  });
  return { live, offline, installed, versions, nativeModules, runCheck, fetchJson };
}

describe('Player Expo compatibility metadata agreement', () => {
  it('resolves only the independently verified SDK 58.0.21 React Native conflict', async () => {
    const value = fixture();
    await expect(verifyPlayerExpoCompatibility(value)).resolves.toEqual({ metadataConflict: true });
    expect(value.runCheck.mock.calls).toEqual([[{ offline: false }], [{ offline: true }]]);
    expect(value.fetchJson.mock.calls).toEqual([[expoVersionsUrl], [expoNativeModulesUrl]]);
  });

  it('still requires the bundled SDK check when live compatibility passes', async () => {
    const value = fixture();
    Object.assign(value.live, { status: 0, stdout: 'Dependencies are up to date\n', stderr: '' });
    await expect(verifyPlayerExpoCompatibility(value)).resolves.toEqual({ metadataConflict: false });
    expect(value.runCheck).toHaveBeenCalledTimes(2);
    expect(value.fetchJson).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong installed React Native', (v) => { v.installed.reactNativeVersion = '0.88.0'; }],
    ['wrong bundled React Native', (v) => { v.installed.bundledNativeModules['react-native'] = '0.88.0'; }],
    ['unreviewed Expo version', (v) => { v.installed.expoVersion = '58.0.22'; }],
    ['previous Expo version', (v) => { v.installed.expoVersion = '58.0.20'; }],
    ['missing bundled matrix', (v) => { v.installed.bundledNativeModules = null; }],
    ['additional package mismatch', (v) => { v.live.stderr += 'expo-camera@58.0.13 - expected version: ~58.0.14\n'; }],
    ['other React Native mismatch', (v) => { v.live.stderr = v.live.stderr.replace('expected version: 0.88.0', 'expected version: 0.88.2'); }],
    ['unknown CLI failure', (v) => { v.live.stderr = 'Unable to contact Expo servers'; }],
    ['different failing exit status', (v) => { v.live.status = 2; }],
    ['live process signal', (v) => { v.live.signal = 'SIGTERM'; }],
    ['offline command failure', (v) => { v.offline.status = 1; }],
    ['offline unexpected output', (v) => { v.offline.stderr += 'Network failure'; }],
    ['missing offline exit status', (v) => { v.offline.status = null; }],
    ['incomplete command result', (v) => { delete v.live.signal; }],
    ['stale CLI versus corrected fresh metadata', (v) => { v.versions.data.sdkVersions['58.0.0'].facebookReactNativeVersion = '0.88.1'; }],
    ['different fresh Expo version', (v) => { v.versions.data.sdkVersions['58.0.0'].expoVersion = '~58.0.22'; }],
    ['different native SDK', (v) => { v.nativeModules.data[0].sdkVersion = '57.0.0'; }],
    ['disagreeing fresh native React Native', (v) => { v.nativeModules.data[0].versionRange = '0.88.0'; }],
    ['disagreeing other fresh native module', (v) => { v.nativeModules.data[1].versionRange = '~58.0.15'; }],
    ['missing fresh native module', (v) => { v.nativeModules.data.pop(); }],
    ['duplicate native module', (v) => { v.nativeModules.data.push(v.nativeModules.data[0]); }],
    ['new native module', (v) => { v.nativeModules.data.push({ sdkVersion: '58.0.0', npmPackage: 'new-module', versionRange: '1.0.0' }); }],
    ['invalid versions response shape', (v) => { v.versions.data = []; }],
    ['invalid native response shape', (v) => { v.nativeModules.data = {}; }],
    ['invalid native entry', (v) => { v.nativeModules.data[0].versionRange = null; }]
  ])('rejects %s', async (_label, mutate) => {
    const value = fixture();
    mutate(value);
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow();
  });

  it('rejects React Native 0.88.0 even if a stale live check passes it', async () => {
    const value = fixture();
    value.installed.reactNativeVersion = '0.88.0';
    Object.assign(value.live, { status: 0, stdout: 'Dependencies are up to date\n', stderr: '' });
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow(/React Native/);
  });

  it('rejects a successful CLI result that silently fell back after network failure', async () => {
    const value = fixture();
    Object.assign(value.live, { status: 0, stdout: 'Dependencies are up to date\n', stderr: 'Unable to fetch Expo versions; using bundled versions.' });
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow(/unexpected output/);
  });

  it('runs the offline check and fails when the live command throws', async () => {
    const value = fixture();
    value.runCheck.mockImplementation(({ offline }) => {
      if (!offline) throw new Error('spawn failed');
      return value.offline;
    });
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow('spawn failed');
    expect(value.runCheck).toHaveBeenCalledTimes(2);
  });

  it('fails when the independent offline command throws after live success', async () => {
    const value = fixture();
    value.runCheck.mockImplementation(({ offline }) => {
      if (offline) throw new Error('offline spawn failed');
      return { ...value.live, status: 0, stdout: 'Dependencies are up to date\n', stderr: '' };
    });
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow('offline spawn failed');
    expect(value.fetchJson).not.toHaveBeenCalled();
  });

  it('fails when fresh endpoint access fails', async () => {
    const value = fixture();
    value.fetchJson.mockRejectedValue(new Error('request failed'));
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow('request failed');
  });
});

describe('credential-free official Expo metadata transport', () => {
  function response(url, changes = {}) {
    return { ok: true, status: 200, url, redirected: false,
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () => '{"data":{}}', ...changes };
  }

  it('fetches only the official URL with no credentials, redirects, or cache reuse', async () => {
    const fetch = vi.fn(async (url) => response(url));
    await expect(fetchExpoPublicMetadata(expoVersionsUrl, fetch)).resolves.toEqual({ data: {} });
    expect(fetch).toHaveBeenCalledWith(expoVersionsUrl, expect.objectContaining({
      credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' }
    }));
  });

  it.each(['https://example.com/versions/latest', 'http://api.expo.dev/v2/versions/latest', `${expoVersionsUrl}?token=value`])('rejects an unreviewed endpoint %s before fetching', async (url) => {
    const fetch = vi.fn();
    await expect(fetchExpoPublicMetadata(url, fetch)).rejects.toThrow(/reviewed public Expo/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP failure', { ok: false, status: 503 }],
    ['unexpected status', { status: 201 }],
    ['redirected endpoint', { redirected: true }],
    ['different final URL', { url: 'https://example.com/' }],
    ['non-JSON content', { headers: new Headers({ 'content-type': 'text/html' }) }],
    ['malformed JSON', { text: async () => '{' }],
    ['oversized response', { text: async () => ' '.repeat(2 * 1024 * 1024 + 1) }]
  ])('fails on %s', async (_label, changes) => {
    await expect(fetchExpoPublicMetadata(expoVersionsUrl, async (url) => response(url, changes))).rejects.toThrow();
  });
});

describe('normal online Expo validation environment', () => {
  it('does not inherit offline, endpoint, platform, Doctor skip, or network-ignore overrides', () => {
    const blocked = ['FORCE_COLOR', 'EXPO_OFFLINE', 'EXPO_API_HOST', 'EXPO_STAGING', 'EXPO_LOCAL', 'EAS_BUILD_PLATFORM',
      'EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK', 'EXPO_DOCTOR_ENABLE_DIRECTORY_CHECK', 'EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS'];
    const parent = { PATH: 'task-bin', ...Object.fromEntries(blocked.map((name) => [name, '1'])) };
    const environment = expoCompatibilityEnvironment(parent);
    expect(environment.PATH).toBe('task-bin');
    for (const key of blocked) expect(environment).not.toHaveProperty(key);
    expect(environment).toMatchObject({ EXPO_NO_CACHE: '1', EXPO_NO_TELEMETRY: '1', NO_COLOR: '1' });
    expect(parent.EXPO_OFFLINE).toBe('1');
    expect(expoCompatibilityEnvironment(parent, true).EXPO_OFFLINE).toBe('1');
  });
});

describe('independent resolution of the sole Expo Doctor metadata false positive', () => {
  function doctorFixture() {
    const doctorResult = { status: 1, signal: null, stdout: [
      'Running 20 checks on your project...',
      '19/20 checks passed. 1 checks failed. Possible issues detected:',
      'Use the --verbose flag to see more details about passed checks.',
      '', '✖ Check that packages match versions required by installed Expo SDK',
      '', '🔧 Patch version mismatches',
      'package       expected  found   ',
      'react-native  0.88.0    0.88.1  ',
      '', '', '', '1 package out of date.', 'Advice:',
      "Use 'npx expo install --check' to review and upgrade your dependencies.",
      'To ignore specific packages, add them to "expo.install.exclude" in package.json. Learn more: https://expo.fyi/dependency-validation',
      '', ''
    ].join('\n'), stderr: '1 check failed, indicating possible issues with the project.\n' };
    return { doctorVersion: '1.20.4', doctorResult, runCompatibilityCheck: vi.fn(async () => ({ metadataConflict: true })) };
  }

  it('retains the raw 19/20 outcome and independently verifies only the incorrect SDK property', async () => {
    const value = doctorFixture();
    await expect(verifyPlayerExpoDoctor(value)).resolves.toEqual({ rawPassed: false, metadataConflict: true });
    expect(value.doctorResult.status).toBe(1);
    expect(value.doctorResult.stdout).toContain('19/20 checks passed.');
    expect(value.runCompatibilityCheck).toHaveBeenCalledTimes(1);
  });

  it('preserves an original successful Doctor run without invoking the conflict resolver', async () => {
    const value = doctorFixture();
    Object.assign(value.doctorResult, { status: 0, stdout: 'Running 20 checks on your project...\n20/20 checks passed. No issues detected!\n', stderr: '' });
    await expect(verifyPlayerExpoDoctor(value)).resolves.toEqual({ rawPassed: true, metadataConflict: false });
    expect(value.runCompatibilityCheck).not.toHaveBeenCalled();
  });

  it.each([
    ['another Doctor version', (v) => { v.doctorVersion = '1.20.5'; }],
    ['additional failed check', (v) => { v.doctorResult.stdout = v.doctorResult.stdout.replace('19/20', '18/20').replace('1 checks failed', '2 checks failed'); }],
    ['different failed check', (v) => { v.doctorResult.stdout = v.doctorResult.stdout.replace('Check that packages match versions required by installed Expo SDK', 'Check native configuration'); }],
    ['another package mismatch', (v) => { v.doctorResult.stdout += 'expo-camera 58.0.14 58.0.13\n'; }],
    ['different expected RN', (v) => { v.doctorResult.stdout = v.doctorResult.stdout.replace('react-native  0.88.0', 'react-native  0.88.2'); }],
    ['different installed RN', (v) => { v.doctorResult.stdout = v.doctorResult.stdout.replace('0.88.1  ', '0.88.0  '); }],
    ['other warning', (v) => { v.doctorResult.stderr += 'Additional warning\n'; }],
    ['network error', (v) => { v.doctorResult.stderr += 'Error connecting to Expo servers\n'; }],
    ['skipped check', (v) => { v.doctorResult.stdout = v.doctorResult.stdout.replace('Running 20', 'Running 19'); }],
    ['unexpected exit status', (v) => { v.doctorResult.status = 2; }],
    ['stopped process', (v) => { v.doctorResult.signal = 'SIGTERM'; }],
    ['missing result shape', (v) => { delete v.doctorResult.stdout; }],
    ['successful status with failed checks', (v) => { v.doctorResult.status = 0; }]
  ])('rejects %s without invoking the metadata resolver', async (_label, mutate) => {
    const value = doctorFixture();
    mutate(value);
    await expect(verifyPlayerExpoDoctor(value)).rejects.toThrow();
    expect(value.runCompatibilityCheck).not.toHaveBeenCalled();
  });

  it('rejects a Doctor result that does not reproduce the fresh live metadata conflict', async () => {
    const value = doctorFixture();
    value.runCompatibilityCheck.mockResolvedValue({ metadataConflict: false });
    await expect(verifyPlayerExpoDoctor(value)).rejects.toThrow(/independently reproduced/);
  });

  it('preserves independent SDK or endpoint failures after the exact Doctor false positive', async () => {
    const value = doctorFixture();
    value.runCompatibilityCheck.mockRejectedValue(new Error('Fresh native matrix disagrees'));
    await expect(verifyPlayerExpoDoctor(value)).rejects.toThrow('Fresh native matrix disagrees');
  });
});
