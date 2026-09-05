import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createExpoConfig,
  validateProductionEnvironment,
  validateProductionUrl,
  v1DisabledFeatureVariables
} = require('../player-app/release-config.cjs');

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

  it('keeps development usable without weakening production validation', () => {
    expect(() => createExpoConfig({ ios: {}, android: {} }, { ORBIT_APP_ENV: 'development' })).not.toThrow();
    expect(() => createExpoConfig({ ios: {}, android: {} }, { ORBIT_APP_ENV: 'production' })).toThrow(
      /Invalid Orbit Player production configuration/
    );
  });
});
