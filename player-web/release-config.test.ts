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

const platformMetadata = {
  VERCEL_URL: 'synthetic-player-candidate.vercel.app',
  VERCEL_ENV: 'production',
  VERCEL_TARGET_ENV: 'production',
  VERCEL_REGION: 'iad1',
  VERCEL_BRANCH_URL: 'synthetic-player-git-main.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: 'orbit-player-web-liart.vercel.app',
  VERCEL_DEPLOYMENT_ID: 'dpl_synthetic',
  VERCEL_PROJECT_ID: 'prj_22SN9L7TvAKHTye7x6PZmBhvNkoq',
  VERCEL_HASH_SALT: 'synthetic-public-salt',
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_SLUG: 'orbit',
  VERCEL_GIT_REPO_OWNER: 'synthetic-owner',
  VERCEL_GIT_REPO_ID: '123',
  VERCEL_GIT_COMMIT_REF: 'main',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_GIT_COMMIT_MESSAGE: 'Synthetic release',
  VERCEL_GIT_COMMIT_AUTHOR_LOGIN: 'synthetic-author',
  VERCEL_GIT_COMMIT_AUTHOR_NAME: 'Synthetic Author',
  VERCEL_GIT_PREVIOUS_SHA: '',
  VERCEL_GIT_PULL_REQUEST_ID: ''
};
const platformMirrors = Object.fromEntries(Object.entries(platformMetadata).map(([name, value]) => [`NEXT_PUBLIC_${name}`, value]));

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

describe('hosted Player Web public platform metadata', () => {
  it.each(Object.entries(platformMetadata))('accepts the documented matching public mirror of %s', (name, value) => {
    expect(() => validateHostedPlayerWebEnvironment({ ...production, ...platformMetadata, [`NEXT_PUBLIC_${name}`]: value })).not.toThrow();
  });
  it('accepts the complete synthetic platform-injected environment without changing application targets', () => {
    expect(() => validateHostedPlayerWebEnvironment({ ...production, ...platformMetadata, ...platformMirrors })).not.toThrow();
  });
  it.each(['VERCEL_PROJECT_ID', 'VERCEL_URL', 'VERCEL_GIT_PULL_REQUEST_ID'])('rejects a public %s mirror without its source counterpart', (name) => {
    expect(() => validateHostedPlayerWebEnvironment({
      ...production, ...platformMetadata, [`NEXT_PUBLIC_${name}`]: platformMirrors[`NEXT_PUBLIC_${name}`], [name]: undefined
    })).toThrow(`NEXT_PUBLIC_${name}`);
  });
  it.each(['VERCEL_PROJECT_ID', 'VERCEL_URL', 'VERCEL_GIT_PULL_REQUEST_ID'])('rejects a public %s override that differs from its source counterpart', (name) => {
    expect(() => validateHostedPlayerWebEnvironment({
      ...production, ...platformMetadata, [`NEXT_PUBLIC_${name}`]: 'unmatched-platform-value'
    })).toThrow(`NEXT_PUBLIC_${name}`);
  });
  it.each([undefined, '0', 'true'])('rejects platform mirrors when VERCEL is %s', (vercel) => {
    expect(() => validateHostedPlayerWebEnvironment({
      ...production, ...platformMetadata, NEXT_PUBLIC_VERCEL_PROJECT_ID: platformMetadata.VERCEL_PROJECT_ID, ORBIT_WEB_ENV: 'production', VERCEL: vercel
    })).toThrow('NEXT_PUBLIC_VERCEL_');
  });
  it('requires an existing string counterpart even when both mirrored values are undefined', () => {
    expect(() => validateHostedPlayerWebEnvironment({
      ...production, VERCEL_GIT_PULL_REQUEST_ID: undefined, NEXT_PUBLIC_VERCEL_GIT_PULL_REQUEST_ID: undefined
    })).toThrow('NEXT_PUBLIC_VERCEL_GIT_PULL_REQUEST_ID');
  });
  it('rejects another Vercel project even when its public and unprefixed IDs match', () => {
    expect(() => validateHostedPlayerWebEnvironment({
      ...production, ...platformMetadata,
      VERCEL_PROJECT_ID: 'prj_unreviewed', NEXT_PUBLIC_VERCEL_PROJECT_ID: 'prj_unreviewed'
    })).toThrow('NEXT_PUBLIC_VERCEL_PROJECT_ID');
  });
  it('accepts documented empty Git metadata as exact string mirrors', () => {
    expect(() => validateHostedPlayerWebEnvironment({
      ...production, VERCEL_GIT_PULL_REQUEST_ID: '', NEXT_PUBLIC_VERCEL_GIT_PULL_REQUEST_ID: '',
      VERCEL_GIT_PREVIOUS_SHA: '', NEXT_PUBLIC_VERCEL_GIT_PREVIOUS_SHA: ''
    })).not.toThrow();
  });
  it.each([
    'VERCEL_SECRET', 'VERCEL_TOKEN', 'VERCEL_OIDC_TOKEN', 'VERCEL_AUTOMATION_BYPASS_SECRET',
    'VERCEL_GIT_SECRET', 'VERCEL_GIT_TOKEN', 'VERCEL_CUSTOM_VALUE', 'VERCEL_PROJECT_NAME'
  ])('rejects an unreviewed public %s even with a matching unprefixed value', (name) => {
    const syntheticValue = 'synthetic-sensitive-value';
    const environment = { ...production, ...platformMetadata, [name]: syntheticValue, [`NEXT_PUBLIC_${name}`]: syntheticValue };
    expect(() => validateHostedPlayerWebEnvironment(environment)).toThrow(`NEXT_PUBLIC_${name}`);
    try { validateHostedPlayerWebEnvironment(environment); } catch (error) {
      expect((error as Error).message).not.toContain(syntheticValue);
    }
  });
  it.each([
    ['NEXT_PUBLIC_FIREBASE_APP_ID', '1:133175572500:web:77d0d79a654f4becfd8f01'],
    ['NEXT_PUBLIC_APP_CHECK_ENABLED', 'false'],
    ['NEXT_PUBLIC_ORBIT_API_URL', 'https://unreviewed.invalid'],
    ['NEXT_PUBLIC_PLAYER_WEB_URL', 'https://unreviewed.invalid'],
    ['FIRESTORE_EMULATOR_HOST', 'localhost:8080']
  ])('retains the original %s guard alongside matching platform metadata', (name, value) => {
    expect(() => validateHostedPlayerWebEnvironment({ ...production, [name]: value, ...platformMetadata, ...platformMirrors })).toThrow(name);
  });
});
