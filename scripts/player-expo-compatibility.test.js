import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  expoCompatibilityEnvironment, verifyPlayerExpoCompatibility, verifyPlayerExpoDoctor
} from './player-expo-compatibility.mjs';
import { productionPlayerEnvironment } from './player-release-environment.mjs';

const retiredLiveMismatch = [
  'The following packages should be updated for best compatibility with the installed expo version:',
  '  react-native@0.88.1 - expected version: 0.88.0',
  'Your project may not work correctly until you install the expected versions of the packages.',
  'Found outdated dependencies\n'
].join('\n');
const retiredDoctorStdout = [
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
].join('\n');

function installedFixture() {
  return {
    expoVersion: '58.0.22', reactNativeVersion: '0.88.1',
    bundledNativeModules: { 'react-native': '0.88.1', 'expo-camera': '~58.0.14' }
  };
}

function fixture() {
  const live = { status: 0, signal: null, stdout: 'Dependencies are up to date\n', stderr: '' };
  const offline = { status: 0, signal: null, stdout: 'Dependencies are up to date\n', stderr: 'Dependency validation is unreliable in offline-mode\n' };
  return { live, offline, installed: installedFixture(),
    runCheck: vi.fn(({ offline: useBundle }) => useBundle ? offline : live) };
}

const checkOrder = [[{ offline: false }], [{ offline: true }]];

describe('strict Player Expo compatibility checks', () => {
  it('requires both live and independent bundled SDK success on the reviewed install', async () => {
    const value = fixture();
    await expect(verifyPlayerExpoCompatibility(value)).resolves.toEqual({ metadataConflict: false });
    expect(value.runCheck.mock.calls).toEqual(checkOrder);
  });

  it('normalizes terminal formatting while retaining the exact success messages', async () => {
    const value = fixture();
    value.live.stdout = '\u001b[32mDependencies are up to date\u001b[0m\r\n';
    await expect(verifyPlayerExpoCompatibility(value)).resolves.toEqual({ metadataConflict: false });
    expect(value.runCheck.mock.calls).toEqual(checkOrder);
  });

  it('rejects the retired SDK 58.0.21 metadata waiver', async () => {
    const value = fixture();
    value.installed.expoVersion = '58.0.21';
    Object.assign(value.live, { status: 1, stdout: '', stderr: retiredLiveMismatch });
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow();
    expect(value.runCheck.mock.calls).toEqual(checkOrder);
  });

  it('does not extend the old React Native mismatch waiver to SDK 58.0.22', async () => {
    const value = fixture();
    Object.assign(value.live, { status: 1, stdout: '', stderr: retiredLiveMismatch });
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow(/live Expo compatibility check failed/);
    expect(value.runCheck.mock.calls).toEqual(checkOrder);
  });

  it.each([
    ['wrong installed React Native', (v) => { v.installed.reactNativeVersion = '0.88.0'; }],
    ['wrong bundled React Native', (v) => { v.installed.bundledNativeModules['react-native'] = '0.88.0'; }],
    ['unreviewed Expo version', (v) => { v.installed.expoVersion = '58.0.23'; }],
    ['previous Expo version', (v) => { v.installed.expoVersion = '58.0.21'; }],
    ['missing installed evidence', (v) => { v.installed = null; }],
    ['missing bundled matrix', (v) => { v.installed.bundledNativeModules = null; }],
    ['array bundled matrix', (v) => { v.installed.bundledNativeModules = []; }],
    ['invalid bundled version', (v) => { v.installed.bundledNativeModules['expo-camera'] = null; }],
    ['empty bundled version', (v) => { v.installed.bundledNativeModules['expo-camera'] = ''; }],
    ['live package mismatch', (v) => { v.live.status = 1; v.live.stderr = 'expo-camera@58.0.13 - expected version: ~58.0.14\n'; }],
    ['other React Native mismatch', (v) => { v.live.status = 1; v.live.stderr = retiredLiveMismatch.replace('expected version: 0.88.0', 'expected version: 0.88.2'); }],
    ['unknown CLI failure', (v) => { v.live.status = 1; v.live.stderr = 'Unable to contact Expo servers'; }],
    ['different failing exit status', (v) => { v.live.status = 2; }],
    ['successful status with outdated packages', (v) => { v.live.stderr = retiredLiveMismatch; }],
    ['live unexpected output', (v) => { v.live.stdout += 'Additional warning\n'; }],
    ['live process signal', (v) => { v.live.signal = 'SIGTERM'; }],
    ['missing live signal', (v) => { delete v.live.signal; }],
    ['missing live exit status', (v) => { v.live.status = null; }],
    ['negative live exit status', (v) => { v.live.status = -1; }],
    ['fractional live exit status', (v) => { v.live.status = 0.5; }],
    ['non-numeric live exit status', (v) => { v.live.status = '0'; }],
    ['missing live stdout', (v) => { delete v.live.stdout; }],
    ['missing live stderr', (v) => { delete v.live.stderr; }],
    ['live spawn failure', (v) => { v.live.error = new Error('spawn failed'); }],
    ['offline command failure', (v) => { v.offline.status = 1; }],
    ['offline unexpected output', (v) => { v.offline.stderr += 'Network failure'; }],
    ['missing offline warning', (v) => { v.offline.stderr = ''; }],
    ['offline successful status with outdated packages', (v) => { v.offline.stdout = retiredLiveMismatch; }],
    ['missing offline exit status', (v) => { v.offline.status = null; }],
    ['offline process signal', (v) => { v.offline.signal = 'SIGTERM'; }],
    ['missing offline signal', (v) => { delete v.offline.signal; }],
    ['missing offline stdout', (v) => { delete v.offline.stdout; }],
    ['offline spawn failure', (v) => { v.offline.error = new Error('offline spawn failed'); }]
  ])('rejects %s and still runs both checks', async (_label, mutate) => {
    const value = fixture();
    mutate(value);
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow();
    expect(value.runCheck.mock.calls).toEqual(checkOrder);
  });

  it('rejects React Native 0.88.0 even if a stale live check passes it', async () => {
    const value = fixture();
    value.installed.reactNativeVersion = '0.88.0';
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow(/React Native/);
  });

  it('rejects a successful CLI result that silently fell back after network failure', async () => {
    const value = fixture();
    value.live.stderr = 'Unable to fetch Expo versions; using bundled versions.';
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow(/unexpected output/);
  });

  it('runs the offline check and fails when the live command throws', async () => {
    const value = fixture();
    value.runCheck.mockImplementation(({ offline }) => {
      if (!offline) throw new Error('spawn failed');
      return value.offline;
    });
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow('spawn failed');
    expect(value.runCheck.mock.calls).toEqual(checkOrder);
  });

  it('fails when the independent offline command throws after live success', async () => {
    const value = fixture();
    value.runCheck.mockImplementation(({ offline }) => {
      if (offline) throw new Error('offline spawn failed');
      return value.live;
    });
    await expect(verifyPlayerExpoCompatibility(value)).rejects.toThrow('offline spawn failed');
    expect(value.runCheck.mock.calls).toEqual(checkOrder);
  });
});

describe('normal online Expo validation environment', () => {
  const blocked = ['FORCE_COLOR', 'EXPO_OFFLINE', 'EXPO_API_HOST', 'EXPO_STAGING', 'EXPO_LOCAL', 'EAS_BUILD_PLATFORM',
    'EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK', 'EXPO_DOCTOR_ENABLE_DIRECTORY_CHECK', 'EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS'];
  const controlled = { EXPO_NO_CACHE: '1', EXPO_NO_TELEMETRY: '1', NO_COLOR: '1' };

  it('does not inherit offline, endpoint, platform, Doctor skip, or network-ignore overrides', () => {
    const parent = { PATH: 'task-bin', ...Object.fromEntries(blocked.map((name) => [name, '1'])) };
    const environment = expoCompatibilityEnvironment(parent);
    expect(environment.PATH).toBe('task-bin');
    for (const key of blocked) expect(environment).not.toHaveProperty(key);
    expect(environment).toMatchObject({ EXPO_NO_CACHE: '1', EXPO_NO_TELEMETRY: '1', NO_COLOR: '1' });
    expect(parent.EXPO_OFFLINE).toBe('1');
    expect(expoCompatibilityEnvironment(parent, true).EXPO_OFFLINE).toBe('1');
  });

  it.each([
    ['lowercase', (name) => name.toLowerCase()],
    ['mixed-case', (name) => name.toLowerCase().replace(/[a-z]/g, (letter, index) => index % 2 ? letter.toUpperCase() : letter)]
  ])('removes %s override keys without dropping unrelated production values', (_label, variant) => {
    const unrelated = { Path: 'task-bin', EXPO_PUBLIC_ORBIT_API_URL: 'http://127.0.0.1:9', ORBIT_APP_ENV: 'production' };
    const parent = { ...unrelated, ...Object.fromEntries(blocked.map((name) => [variant(name), '1'])) };
    const original = { ...parent };
    const online = expoCompatibilityEnvironment(parent);
    expect(Object.keys(online).filter((key) => blocked.includes(key.toUpperCase()))).toEqual([]);
    expect(online).toMatchObject({ ...unrelated, ...controlled });
    const offline = expoCompatibilityEnvironment(parent, true);
    expect(Object.keys(offline).filter((key) => key.toUpperCase() === 'EXPO_OFFLINE')).toEqual(['EXPO_OFFLINE']);
    expect(offline.EXPO_OFFLINE).toBe('1');
    expect(parent).toEqual(original);
  });

  it('deduplicates casing variants before setting controlled uppercase values', () => {
    const parent = Object.fromEntries(Object.keys(controlled).flatMap((name) =>
      [[name, '0'], [name.toLowerCase(), '0'], [name[0] + name.slice(1).toLowerCase(), '0']]));
    const environment = expoCompatibilityEnvironment(parent);
    expect(Object.keys(environment).filter((key) => Object.hasOwn(controlled, key.toUpperCase())).sort())
      .toEqual(Object.keys(controlled).sort());
    expect(environment).toMatchObject(controlled);
  });

  it('removes synthetic overrides surviving the production environment filter', () => {
    const marker = 'http://127.0.0.1:9/validation-host-marker';
    const parent = { EXPO_API_HOST: marker, expo_api_host: marker,
      EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK: '1', ExPo_DoCtOr_SkIp_DePeNdEnCy_VeRsIoN_ChEcK: '1' };
    const production = productionPlayerEnvironment(parent);
    expect(production).toMatchObject(parent);
    const environment = expoCompatibilityEnvironment(production);
    expect(Object.keys(environment).filter((key) => blocked.includes(key.toUpperCase()))).toEqual([]);
    for (const [key, value] of Object.entries(production)) {
      if (!blocked.includes(key.toUpperCase()) && !Object.hasOwn(controlled, key.toUpperCase())) {
        expect(environment[key]).toBe(value);
      }
    }
  });

  it('passes only reviewed validation controls to a real Node child without contacting a service', () => {
    const parent = { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      expo_api_host: 'http://127.0.0.1:9/validation-host-marker', ExPo_DoCtOr_SkIp_DePeNdEnCy_VeRsIoN_ChEcK: '1',
      expo_no_cache: '0', ExPo_No_TeLeMeTrY: '0', no_color: '0', SYNTHETIC_VALIDATION_MARKER: 'retained' };
    const environment = expoCompatibilityEnvironment(productionPlayerEnvironment(parent));
    const child = spawnSync(process.execPath, ['-e', [
      'const blocked = ' + JSON.stringify(blocked) + ';',
      'process.stdout.write(JSON.stringify({',
      'platform: process.platform,',
      'forbiddenKeys: Object.keys(process.env).filter((key) => blocked.includes(key.toUpperCase())),',
      'apiHost: process.env.EXPO_API_HOST ?? null,',
      'doctorSkip: process.env.EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK ?? null,',
      'offline: process.env.EXPO_OFFLINE ?? null,',
      'fixed: { EXPO_NO_CACHE: process.env.EXPO_NO_CACHE, EXPO_NO_TELEMETRY: process.env.EXPO_NO_TELEMETRY, NO_COLOR: process.env.NO_COLOR },',
      'marker: process.env.SYNTHETIC_VALIDATION_MARKER',
      '}));'
    ].join('\n')], { env: environment, encoding: 'utf8', timeout: 5000, windowsHide: true });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    expect(JSON.parse(child.stdout)).toEqual({ platform: process.platform, forbiddenKeys: [],
      apiHost: null, doctorSkip: null, offline: null, fixed: controlled, marker: 'retained' });
  });
});

function doctorFixture() {
  return {
    installed: installedFixture(), doctorVersion: '1.20.4',
    doctorResult: { status: 0, signal: null,
      stdout: 'Running 20 checks on your project...\n20/20 checks passed. No issues detected!\n', stderr: '' }
  };
}

describe('bounded process exit statuses', () => {
  it.each(['live', 'offline', 'Doctor'].flatMap((phase) =>
    [256, 0xc0000005].map((status) => [phase, status])))('rejects %s status %i with a safe failure exit code', async (phase, status) => {
    const value = phase === 'Doctor' ? doctorFixture() : fixture();
    const result = phase === 'Doctor' ? value.doctorResult : value[phase];
    result.status = status;
    const verification = phase === 'Doctor' ? verifyPlayerExpoDoctor(value) : verifyPlayerExpoCompatibility(value);
    const label = phase === 'offline' ? 'bundled SDK' : phase;
    await expect(verification).rejects.toMatchObject({
      message: `Expo ${label} compatibility check did not complete normally.`, exitCode: 1
    });
    if (phase !== 'Doctor') expect(value.runCheck.mock.calls).toEqual(checkOrder);
  });
});

describe('strict original Expo Doctor checks', () => {
  it('accepts only the reviewed original raw 20/20 Doctor success', async () => {
    await expect(verifyPlayerExpoDoctor(doctorFixture())).resolves.toEqual({ rawPassed: true, metadataConflict: false });
  });

  it('rejects the retired raw 19/20 Doctor metadata waiver', async () => {
    const value = doctorFixture();
    Object.assign(value.doctorResult, {
      status: 1, stdout: retiredDoctorStdout, stderr: '1 check failed, indicating possible issues with the project.\n'
    });
    const retiredResolver = vi.fn(async () => ({ metadataConflict: true }));
    await expect(verifyPlayerExpoDoctor({ ...value, runCompatibilityCheck: retiredResolver })).rejects.toThrow();
    expect(retiredResolver).not.toHaveBeenCalled();
  });

  it.each([
    ['another Doctor version', (v) => { v.doctorVersion = '1.20.5'; }],
    ['missing Doctor version', (v) => { delete v.doctorVersion; }],
    ['previous Expo install', (v) => { v.installed.expoVersion = '58.0.21'; }],
    ['wrong installed React Native', (v) => { v.installed.reactNativeVersion = '0.88.0'; }],
    ['wrong bundled React Native', (v) => { v.installed.bundledNativeModules['react-native'] = '0.88.0'; }],
    ['missing installed evidence', (v) => { v.installed = null; }],
    ['additional failed check', (v) => { v.doctorResult.stdout = v.doctorResult.stdout.replace('20/20 checks passed. No issues detected!', '18/20 checks passed. 2 checks failed. Possible issues detected:'); }],
    ['another package mismatch', (v) => { v.doctorResult.stdout += 'expo-camera 58.0.14 58.0.13\n'; }],
    ['other warning', (v) => { v.doctorResult.stderr += 'Additional warning\n'; }],
    ['network error', (v) => { v.doctorResult.stderr += 'Error connecting to Expo servers\n'; }],
    ['skipped check', (v) => { v.doctorResult.stdout = v.doctorResult.stdout.replace('Running 20', 'Running 19'); }],
    ['reduced successful checks', (v) => { v.doctorResult.stdout = v.doctorResult.stdout.replace('20', '19').replace('20/20', '19/19'); }],
    ['additional successful checks', (v) => { v.doctorResult.stdout = v.doctorResult.stdout.replaceAll('20', '21'); }],
    ['missing check count', (v) => { v.doctorResult.stdout = '20/20 checks passed. No issues detected!\n'; }],
    ['verbose extra output', (v) => { v.doctorResult.stdout += '✔ Additional check details\n'; }],
    ['explicit skipped output', (v) => { v.doctorResult.stdout += 'Skipped dependency version check\n'; }],
    ['unexpected exit status', (v) => { v.doctorResult.status = 2; }],
    ['failed status with successful output', (v) => { v.doctorResult.status = 1; }],
    ['stopped process', (v) => { v.doctorResult.signal = 'SIGTERM'; }],
    ['missing process signal', (v) => { delete v.doctorResult.signal; }],
    ['missing stdout', (v) => { delete v.doctorResult.stdout; }],
    ['missing stderr', (v) => { delete v.doctorResult.stderr; }],
    ['missing exit status', (v) => { v.doctorResult.status = null; }],
    ['negative exit status', (v) => { v.doctorResult.status = -1; }],
    ['fractional exit status', (v) => { v.doctorResult.status = 0.5; }],
    ['spawn failure', (v) => { v.doctorResult.error = new Error('Doctor spawn failed'); }],
    ['empty output', (v) => { v.doctorResult.stdout = ''; }],
    ['successful status with the former failure', (v) => {
      v.doctorResult.stdout = retiredDoctorStdout;
      v.doctorResult.stderr = '1 check failed, indicating possible issues with the project.\n';
    }]
  ])('rejects %s', async (_label, mutate) => {
    const value = doctorFixture();
    mutate(value);
    await expect(verifyPlayerExpoDoctor(value)).rejects.toThrow();
  });
});
