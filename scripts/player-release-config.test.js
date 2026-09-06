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
  it('passes the repository-locked EAS schema and resolves every iOS profile', async () => {
    const accessor = EasJsonAccessor.fromProjectPath(playerRoot);

    await expect(accessor.readAsync()).resolves.toBeTruthy();
    for (const profileName of ['development', 'preview', 'production']) {
      await expect(EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, profileName)).resolves.toMatchObject({
        node: '22.16.0'
      });
      expect(eas.build[profileName]).not.toHaveProperty('npm');
    }
  });

  it('proves the locked schema rejects the unsupported npm profile field', async () => {
    const invalidEas = structuredClone(eas);
    invalidEas.build.production.npm = EXPECTED_NPM_VERSION;

    await expect(EasJsonAccessor.fromRawString(JSON.stringify(invalidEas)).readAsync()).rejects.toThrow(/npm.*not allowed/);
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
});

function validProductionEnvironment() {
  return {
    ORBIT_APP_ENV: 'production',
    EXPO_PUBLIC_ORBIT_API_URL: 'https://orbitapp-one.vercel.app',
    EXPO_PUBLIC_PRIVACY_POLICY_URL: 'https://orbitapp-one.vercel.app/privacy',
    EXPO_PUBLIC_SUPPORT_URL: 'https://orbitapp-one.vercel.app/support',
    EXPO_PUBLIC_TERMS_OF_SERVICE_URL: 'https://orbitapp-one.vercel.app/terms',
    ...Object.fromEntries(v1DisabledFeatureVariables.map((name) => [name, 'false']))
  };
}

describe('Orbit Player production configuration', () => {
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
