import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reviewedPlayerCollectedDataTypes } from './player-privacy-manifest.mjs';

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playerRoot = path.join(repositoryRoot, 'player-app');
const eas = JSON.parse(fs.readFileSync(path.join(playerRoot, 'eas.json'), 'utf8'));
const playerPackage = JSON.parse(fs.readFileSync(path.join(playerRoot, 'package.json'), 'utf8'));
const expectedProductionIosImage = 'macos-tahoe-26.6-xcode-27.0';
const easCliRequire = createRequire(path.join(repositoryRoot, 'node_modules', 'eas-cli', 'package.json'));
const { EasJsonAccessor, EasJsonUtils, Platform } = easCliRequire('@expo/eas-json');
const { EXPECTED_NPM_VERSION, pinEasNpm } = require('../player-app/scripts/pin-eas-npm.cjs');
const {
  createExpoConfig,
  validateProductionEnvironment,
  validateProductionUrl,
  v1DisabledFeatureVariables
} = require('../player-app/release-config.cjs');

describe('Orbit Player EAS build configuration', () => {
  it('aligns the user-selected iOS identity with native Firebase while preserving Android identity', () => {
    const app = JSON.parse(fs.readFileSync(path.join(playerRoot, 'app.json'), 'utf8')).expo;
    const configured = createExpoConfig(app, eas.build.production.env);
    const plist = require('../player-app/node_modules/@expo/plist').default;
    const ios = plist.parse(fs.readFileSync(path.join(playerRoot, 'GoogleService-Info.plist'), 'utf8'));
    const android = JSON.parse(fs.readFileSync(path.join(playerRoot, 'google-services.json'), 'utf8'));
    expect(configured.ios.bundleIdentifier).toBe('com.caminuslabs.orbit');
    expect(ios.BUNDLE_ID).toBe('com.caminuslabs.orbit');
    expect(ios.GOOGLE_APP_ID).toBe('1:133175572500:ios:de1514cf1736c1bdfd8f01');
    expect(ios.PROJECT_ID).toBe('tabletalk-s');
    expect(ios.IS_ANALYTICS_ENABLED).toBe(false); expect(ios.IS_ADS_ENABLED).toBe(false);
    expect(configured.android.package).toBe('com.orbit.player');
    expect(android.project_info.project_id).toBe('tabletalk-s');
    expect(android.client[0].client_info.android_client_info.package_name).toBe('com.orbit.player');
    expect(android.client[0].client_info.mobilesdk_app_id).toBe('1:133175572500:android:522b4cfc8de1a770fd8f01');
    expect(configured.ios.entitlements).toEqual({ 'com.apple.developer.devicecheck.appattest-environment': 'production' });
    expect(configured.plugins).toContain('./plugins/with-firebase-scene-initialization.cjs');
    expect(eas.build.production.env.EXPO_PUBLIC_APP_CHECK_ENABLED).toBe('true');
  });

  it('passes the repository-locked EAS schema and resolves every iOS profile', async () => {
    const accessor = EasJsonAccessor.fromProjectPath(playerRoot);

    await expect(accessor.readAsync()).resolves.toBeTruthy();
    for (const profileName of ['development', 'preview', 'production', 'simulator', 'iphone-test']) {
      const profile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, profileName);
      expect(profile).toMatchObject({ node: '22.16.0' });
      expect(profile).not.toHaveProperty('config');
      expect(eas.build[profileName]).not.toHaveProperty('npm');
    }
  });

  it('keeps simulator compiler validation on production settings without incrementing store builds', async () => {
    const accessor = EasJsonAccessor.fromProjectPath(playerRoot);
    const profile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'simulator');
    expect(profile).toMatchObject({
      distribution: 'internal', environment: 'production', simulator: true, autoIncrement: false,
      image: expectedProductionIosImage, node: '22.16.0', env: eas.build.production.env
    });
    expect(() => validateProductionEnvironment(profile.env)).not.toThrow();
  });

  it('keeps physical iPhone test configuration on production protections without a store release or build-number increment', async () => {
    const accessor = EasJsonAccessor.fromProjectPath(playerRoot);
    const profile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'iphone-test');
    expect(profile).toMatchObject({
      distribution: 'internal', environment: 'production', simulator: false, autoIncrement: false,
      image: expectedProductionIosImage, node: '22.16.0', env: eas.build.production.env
    });
    expect(profile.env.EXPO_PUBLIC_APP_CHECK_ENABLED).toBe('true');
    expect(profile).not.toHaveProperty('config');
    expect(eas.cli.requireCommit).toBe(true);
    expect(() => validateProductionEnvironment(profile.env)).not.toThrow();
  });

  it('proves the locked schema rejects the unsupported npm profile field', async () => {
    const invalidEas = structuredClone(eas);
    invalidEas.build.production.npm = EXPECTED_NPM_VERSION;

    await expect(EasJsonAccessor.fromRawString(JSON.stringify(invalidEas)).readAsync()).rejects.toThrow(/npm.*not allowed/);
  });

  it('pins production uploads to the reviewed stable SDK 58 Xcode 27.0 image', async () => {
    const accessor = EasJsonAccessor.fromProjectPath(playerRoot);
    const profile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');

    expect(eas.build.production.ios).toMatchObject({
      image: expectedProductionIosImage,
      simulator: false
    });
    expect(profile).toMatchObject({ image: expectedProductionIosImage });
  });

  it('installs and verifies the exact npm version before EAS dependency installation', () => {
    const calls = [];
    const run = (command, arguments_, options) => {
      calls.push({ command, arguments_, options });
      return arguments_[0] === '--version'
        ? { status: 0, stdout: `${EXPECTED_NPM_VERSION}\n` }
        : { status: 0 };
    };
    const logger = { error() {}, log() {} };

    expect(playerPackage.scripts['eas-build-pre-install']).toBe('node scripts/pin-eas-npm.cjs');
    expect(pinEasNpm({ platform: 'darwin', run, logger })).toBe(0);
    expect(calls.map(({ command, arguments_ }) => [command, arguments_])).toEqual([
      ['npm', ['install', '--global', 'npm@10.9.2', '--no-audit', '--no-fund']],
      ['npm', ['--version']]
    ]);
  });

  it('fails closed when the installed npm version does not match', () => {
    const run = (_command, arguments_) => arguments_[0] === '--version'
      ? { status: 0, stdout: '10.9.3\n' }
      : { status: 0 };

    expect(pinEasNpm({ run, logger: { error() {}, log() {} } })).toBe(1);
  });

  it('invokes npm through the Windows command interpreter when required', () => {
    const calls = [];
    const run = (command, arguments_) => {
      calls.push([command, arguments_]);
      return arguments_.at(-1) === 'npm --version'
        ? { status: 0, stdout: `${EXPECTED_NPM_VERSION}\n` }
        : { status: 0 };
    };

    expect(pinEasNpm({
      platform: 'win32',
      commandInterpreter: 'cmd.exe',
      run,
      logger: { error() {}, log() {} }
    })).toBe(0);
    expect(calls).toEqual([
      ['cmd.exe', ['/d', '/s', '/c', 'npm install --global npm@10.9.2 --no-audit --no-fund']],
      ['cmd.exe', ['/d', '/s', '/c', 'npm --version']]
    ]);
  });
});

function validProductionEnvironment() {
  return {
    ORBIT_APP_ENV: 'production',
    EXPO_PUBLIC_APP_CHECK_ENABLED: 'true',
    EXPO_PUBLIC_ORBIT_API_URL: 'https://orbitapp-one.vercel.app',
    EXPO_PUBLIC_PRIVACY_POLICY_URL: 'https://orbitapp-one.vercel.app/privacy',
    EXPO_PUBLIC_SUPPORT_URL: 'https://orbitapp-one.vercel.app/support',
    EXPO_PUBLIC_TERMS_OF_SERVICE_URL: 'https://orbitapp-one.vercel.app/terms',
    ...Object.fromEntries(v1DisabledFeatureVariables.map((name) => [name, 'false']))
  };
}

describe('Orbit Player production configuration', () => {
  it('accepts Metro project-root metadata only for the actual Player directory', () => {
    expect(() => validateProductionEnvironment({ ...validProductionEnvironment(), EXPO_PUBLIC_PROJECT_ROOT: playerRoot })).not.toThrow();
    for (const root of ['', '.', repositoryRoot, path.join(playerRoot, 'private-value'), 'https://untrusted.example', null]) {
      expect(() => validateProductionEnvironment({ ...validProductionEnvironment(), EXPO_PUBLIC_PROJECT_ROOT: root })).toThrow('EXPO_PUBLIC_PROJECT_ROOT must identify');
    }
  });
  it('rejects unreviewed native Firebase SDK overrides without exposing their values', () => {
    expect(() => validateProductionEnvironment({ ...validProductionEnvironment(), FIREBASE_SDK_VERSION: 'unreviewed' })).toThrow('FIREBASE_SDK_VERSION overrides are not approved');
  });
  it.each([undefined, '', 'false'])('rejects production without App Check (%s)', (value) => {
    expect(() => validateProductionEnvironment({ ...validProductionEnvironment(), EXPO_PUBLIC_APP_CHECK_ENABLED: value })).toThrow(/EXPO_PUBLIC_APP_CHECK_ENABLED must be true/);
  });
  it('accepts only the reviewed production URLs with every risky v1 capability explicitly off', () => {
    expect(() => validateProductionEnvironment(validProductionEnvironment())).not.toThrow();
    expect(validateProductionUrl(
      'EXPO_PUBLIC_PRIVACY_POLICY_URL',
      'https://different-public-host.example.org/privacy',
      '/privacy'
    )).toMatch(/repository-approved Orbit production origin/);
  });

  it('rejects unexpected public variables in production', () => {
    expect(() => validateProductionEnvironment({
      ...validProductionEnvironment(),
      EXPO_PUBLIC_UNREVIEWED_FEATURE: 'enabled'
    })).toThrow('EXPO_PUBLIC_UNREVIEWED_FEATURE is not an approved public variable');
  });

  it('fails closed without printing supplied values', () => {
    const environment = validProductionEnvironment();
    environment.EXPO_PUBLIC_ORBIT_API_URL = 'https://user:do-not-print@example.com/path?token=do-not-print';
    delete environment.ORBIT_V1_PRIVATE_GAMES_ENABLED;

    let message = '';
    try {
      validateProductionEnvironment(environment);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('EXPO_PUBLIC_ORBIT_API_URL');
    expect(message).toContain('ORBIT_V1_PRIVATE_GAMES_ENABLED');
    expect(message).not.toContain('do-not-print');
  });

  it('removes recording permissions and unused iOS map configuration', () => {
    const config = createExpoConfig({
      ios: { config: { googleMapsApiKey: 'do-not-print' } },
      android: {},
      plugins: []
    }, validProductionEnvironment());
    const cameraPlugin = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera');

    expect(cameraPlugin?.[1]).toMatchObject({ microphonePermission: false, recordAudioAndroid: false });
    expect(config.android.blockedPermissions).toContain('android.permission.RECORD_AUDIO');
    expect(config.ios.config).not.toHaveProperty('googleMapsApiKey');
    expect(config.plugins.at(-1)).toBe('./plugins/with-no-ios-url-schemes.cjs');
    expect(JSON.stringify(config)).not.toContain('do-not-print');
  });
  it('allows only explicit one-shot foreground location and blocks background and motion capabilities', () => {
    const config = createExpoConfig({ ios: {}, android: {}, plugins: [['expo-location', { isIosBackgroundLocationEnabled: true }]] }, validProductionEnvironment());
    const plugins = config.plugins.filter((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location');
    expect(plugins).toHaveLength(1);
    expect(plugins[0][1]).toMatchObject({ locationAlwaysPermission: false, locationAlwaysAndWhenInUsePermission: false, motionUsagePermission: false,
      isIosBackgroundLocationEnabled: false, isAndroidBackgroundLocationEnabled: false, isAndroidForegroundServiceEnabled: false, isAndroidMotionActivityEnabled: false });
    expect(config.android.blockedPermissions).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
    expect(config.android.blockedPermissions).toContain('android.permission.ACTIVITY_RECOGNITION');
  });
  it('removes background location and motion from generated iOS settings while preserving foreground and camera purposes', async () => {
    const withReleasePolicy = require('../player-app/plugins/with-no-ios-url-schemes.cjs');
    const config = withReleasePolicy({ name: 'Orbit', slug: 'orbit-player' });
    const result = await config.mods.ios.infoPlist({ ...config, modRequest: {}, modResults: {
      CFBundleURLTypes: [{ CFBundleURLSchemes: ['unused'] }],
      NSLocationWhenInUseUsageDescription: 'Foreground location purpose', NSCameraUsageDescription: 'Camera purpose',
      NSLocationAlwaysUsageDescription: 'Unused', NSLocationAlwaysAndWhenInUseUsageDescription: 'Unused', NSMotionUsageDescription: 'Unused',
      UIBackgroundModes: ['location', 'fetch']
    } });
    expect(result.modResults).toEqual({ NSLocationWhenInUseUsageDescription: 'Foreground location purpose', NSCameraUsageDescription: 'Camera purpose', UIBackgroundModes: ['fetch'] });
    const empty = await config.mods.ios.infoPlist({ ...config, modRequest: {}, modResults: { UIBackgroundModes: ['location'] } });
    expect(empty.modResults).not.toHaveProperty('UIBackgroundModes');
  });

  it('preserves the reviewed collected-data declaration for Expo serialization', () => {
    const config = createExpoConfig({
      ios: {
        privacyManifests: {
          NSPrivacyTracking: false,
          NSPrivacyCollectedDataTypes: reviewedPlayerCollectedDataTypes
        }
      },
      android: {},
      plugins: []
    }, validProductionEnvironment());

    expect(config.ios.privacyManifests).toEqual({
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: reviewedPlayerCollectedDataTypes
    });
  });

  it('keeps development usable without weakening production validation', () => {
    expect(() => createExpoConfig({ ios: {}, android: {} }, { ORBIT_APP_ENV: 'development' })).not.toThrow();
    expect(() => createExpoConfig({ ios: {}, android: {} }, { ORBIT_APP_ENV: 'production' })).toThrow(
      /Invalid Orbit Player production configuration/
    );
  });
});
