import { describe, expect, it } from 'vitest';
import { validateHostedPlayerWebEnvironment } from './release-config';

const production = {
  VERCEL: '1',
  ORBIT_API_URL: 'https://orbitapp-one.vercel.app',
  NEXT_PUBLIC_ORBIT_API_URL: 'https://orbitapp-one.vercel.app',
  NEXT_PUBLIC_PLAYER_WEB_URL: 'https://orbit-player-web-liart.vercel.app',
  NEXT_PUBLIC_ENABLE_FIREBASE_SYNC: 'true',
  NEXT_PUBLIC_APP_CHECK_ENABLED: 'true',
  NEXT_PUBLIC_APP_CHECK_SITE_KEY: `6L${'a'.repeat(38)}`,
  NEXT_PUBLIC_FIREBASE_API_KEY: `AIza${'a'.repeat(35)}`,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'tabletalk-s',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'tabletalk-s.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'tabletalk-s.firebasestorage.app',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '133175572500',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:133175572500:web:5e1055ff74e92d29fd8f01'
};

describe('hosted Player Web release configuration', () => {
  it('accepts the complete verified production targets', () => {
    expect(() => validateHostedPlayerWebEnvironment(production)).not.toThrow();
  });
  it.each(Object.keys(production).filter((name) => name !== 'VERCEL'))('rejects missing %s without echoing its value', (name) => {
    expect(() => validateHostedPlayerWebEnvironment({ ...production, [name]: '' })).toThrow(name);
  });
  it.each([
    ['ORBIT_API_URL', 'http://127.0.0.1:4629'],
    ['NEXT_PUBLIC_ORBIT_API_URL', 'https://user:password@orbitapp-one.vercel.app'],
    ['NEXT_PUBLIC_FIREBASE_APP_ID', '1:133175572500:web:77d0d79a654f4becfd8f01'],
    ['NEXT_PUBLIC_APP_CHECK_ENABLED', 'false'],
    ['NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST', 'localhost:9099'],
    ['FIRESTORE_EMULATOR_HOST', 'localhost:8080'],
    ['NEXT_PUBLIC_UNREVIEWED_VALUE', 'private-value']
  ])('rejects unsafe %s overrides', (name, value) => {
    expect(() => validateHostedPlayerWebEnvironment({ ...production, [name]: value })).toThrow(name);
    try { validateHostedPlayerWebEnvironment({ ...production, [name]: value }); } catch (error) {
      expect((error as Error).message).not.toContain(value);
    }
  });
  it('retains isolated local build and emulator workflows', () => {
    expect(() => validateHostedPlayerWebEnvironment({ NODE_ENV: 'production', ORBIT_API_URL: 'http://127.0.0.1:4629' })).not.toThrow();
    expect(() => validateHostedPlayerWebEnvironment({ ORBIT_WEB_ENV: 'production' })).toThrow();
  });
});
